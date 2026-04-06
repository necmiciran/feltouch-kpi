/** Clamp a value to [0, 1]. Returns null if value is null/NaN. */
function clamp01(x) {
  if (x == null || Number.isNaN(x)) return null;
  return Math.max(0, Math.min(1, x));
}

/**
 * Goal-line success for one quarter.
 * Returns null (N/A) if target is null/0.
 * If target exists but actual is missing, treats actual as 0.
 */
function success(actual, target) {
  if (target == null || target === 0) return null;
  if (actual == null) return 0;
  return clamp01(Number(actual) / Number(target));
}

/**
 * KPI success = weighted average of goal-line successes for that KPI & quarter.
 * Weight rules:
 *   - measure_type === 'count' → weight = quarter target (bigger targets count more)
 *   - measure_type === 'ratio' | 'score' → weight = 1
 * Goal lines with N/A target in that quarter are excluded.
 */
function computeKpiSuccess(goalsForKpi, quarter) {
  let num = 0;
  let den = 0;

  for (const g of goalsForKpi) {
    const t = g.targets?.[quarter] ?? null;
    if (t == null || t === 0) continue; // N/A this quarter
    if (g.kpi_no == null) continue;

    const s = success(g.actual?.[quarter] ?? null, t);
    if (s == null) continue;

    const w = g.measure_type === "count" ? (t || 0) : 1;
    if (w <= 0) continue;

    num += s * w;
    den += w;
  }

  if (den === 0) return null;
  return num / den;
}

/** Compute per-KPI and total score for one employee in one quarter. */
function computeEmployeeQuarter(db, employeeCode, quarter) {
  const kpis = db
    .prepare("SELECT * FROM kpis WHERE employee_code=? ORDER BY kpi_no")
    .all(employeeCode);

  const goals = db.prepare(`
    SELECT g.*,
      u_q1.actual AS a_q1, u_q2.actual AS a_q2,
      u_q3.actual AS a_q3, u_q4.actual AS a_q4
    FROM goals g
      LEFT JOIN goal_updates u_q1 ON u_q1.goal_id=g.id AND u_q1.quarter='Q1'
      LEFT JOIN goal_updates u_q2 ON u_q2.goal_id=g.id AND u_q2.quarter='Q2'
      LEFT JOIN goal_updates u_q3 ON u_q3.goal_id=g.id AND u_q3.quarter='Q3'
      LEFT JOIN goal_updates u_q4 ON u_q4.goal_id=g.id AND u_q4.quarter='Q4'
    WHERE g.employee_code=?
  `).all(employeeCode);

  const normGoals = goals.map(g => ({
    id: g.id,
    employee_code: g.employee_code,
    category: g.category,
    topic: g.topic,
    detail: g.detail,
    kpi_no: g.kpi_no,
    measure_type: g.measure_type,
    targets: { Q1: g.target_q1, Q2: g.target_q2, Q3: g.target_q3, Q4: g.target_q4 },
    actual: { Q1: g.a_q1, Q2: g.a_q2, Q3: g.a_q3, Q4: g.a_q4 },
  }));

  const perKpi = [];
  let total = 0;
  let totalWeight = 0;

  for (const k of kpis) {
    const goalsForKpi = normGoals.filter(g => g.kpi_no === k.kpi_no);
    const ks = computeKpiSuccess(goalsForKpi, quarter);
    const score100 = ks == null ? null : Math.round(ks * 1000) / 10; // 1 decimal

    perKpi.push({
      kpi_no: k.kpi_no,
      title: k.title,
      weight: k.weight,
      success: ks,
      score: score100,
      kpi_target: ({ Q1: k.target_q1, Q2: k.target_q2, Q3: k.target_q3, Q4: k.target_q4 })[quarter] ?? null
    });

    if (score100 != null) {
      total += (score100 * k.weight / 100);
      totalWeight += k.weight;
    }
  }

  const totalRounded = Math.round(total * 10) / 10;
  return { quarter, perKpi, total: totalRounded };
}

function avg2(a, b) {
  const vals = [a, b].filter(v => v != null && !Number.isNaN(v));
  if (!vals.length) return null;
  return Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10;
}

/** Full employee summary: all quarters, half-years, bonus. */
function computeEmployeeSummary(db, employeeCode) {
  const quarters = {};
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
    quarters[q] = computeEmployeeQuarter(db, employeeCode, q);
  }

  const h1 = avg2(quarters.Q1.total, quarters.Q2.total);
  const h2 = avg2(quarters.Q3.total, quarters.Q4.total);

  const emp = db.prepare("SELECT * FROM employees WHERE code=?").get(employeeCode);
  const annualBonus = emp?.annual_bonus ?? 0;

  const h1Ent = annualBonus / 2;
  const h2Ent = annualBonus / 2;
  const h1Net = h1 == null ? 0 : Math.round(h1Ent * (h1 / 100));
  const h2Net = h2 == null ? 0 : Math.round(h2Ent * (h2 / 100));

  return {
    employee_code: employeeCode,
    name: emp?.name,
    title: emp?.title,
    quarters,
    half_year: { H1: h1, H2: h2 },
    bonus: {
      annual_bonus: annualBonus,
      H1_entitlement: h1Ent,
      H2_entitlement: h2Ent,
      H1_net: h1Net,
      H2_net: h2Net,
      annual_net: h1Net + h2Net
    }
  };
}

/** Manager quarter score = weighted avg of team member quarter totals. */
function computeManagerQuarter(db, quarter, weights) {
  let num = 0;
  let den = 0;
  for (const [emp, w] of Object.entries(weights)) {
    const q = computeEmployeeQuarter(db, emp, quarter);
    if (q.total == null) continue;
    num += q.total * w;
    den += w;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 10) / 10;
}

/** Full manager (Necmi) summary with quarterly bonuses. */
function computeManagerSummary(db) {
  const cfg = db.prepare("SELECT value_json FROM config WHERE key='manager_weights'").get();
  const weights = cfg
    ? JSON.parse(cfg.value_json)
    : { YIGIT: 0.30, SENA: 0.30, ASLI: 0.25, EMRULLAH: 0.15 };

  // Normalize weights so they sum to 1
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const normWeights = {};
  for (const [k, v] of Object.entries(weights)) {
    normWeights[k] = weightSum > 0 ? v / weightSum : 0;
  }

  const qScores = {};
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
    qScores[q] = computeManagerQuarter(db, q, normWeights);
  }

  const emp = db.prepare("SELECT * FROM employees WHERE code='NECMI'").get();
  const annualBonus = emp?.annual_bonus ?? 0;
  const qEnt = annualBonus / 4;

  const qNet = {};
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
    const score = qScores[q];
    qNet[q] = score == null ? 0 : Math.round(qEnt * (score / 100));
  }

  const totalNet = Object.values(qNet).reduce((a, b) => a + b, 0);

  return {
    weights: normWeights,
    qScores,
    qBonus: { entitlement: qEnt, net: qNet, total: totalNet }
  };
}

module.exports = {
  computeEmployeeSummary,
  computeEmployeeQuarter,
  computeManagerSummary,
  success
};
