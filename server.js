const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const { openDb, initDb, isSeeded, DB_PATH } = require("./db");
const { computeEmployeeSummary, computeEmployeeQuarter, computeManagerSummary } = require("./compute");

const app = express();
const db = openDb();
initDb(db);

if (!isSeeded(db)) {
  console.warn("[uyarı] Veritabanı boş. Çalıştırın: npm run seed");
}

app.use(express.json({ limit: "4mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "feltouch-kpi-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 saat
}));

app.use(express.static(path.join(__dirname, "public")));

// ── Auth Middlewares ────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "unauthorized" });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "unauthorized" });
    if (req.session.user.role !== role) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

// ── Audit Helper ────────────────────────────────────────────────────────────

function audit(actor, action, entity, entityId, detail) {
  try {
    db.prepare(
      "INSERT INTO audit_log(actor,action,entity,entity_id,detail) VALUES(?,?,?,?,?)"
    ).run(actor, action, entity || null, entityId ? String(entityId) : null, detail || null);
  } catch (e) {
    console.error("[audit]", e.message);
  }
}

// ── Quarter Lock Helper ─────────────────────────────────────────────────────

function isQuarterLocked(employeeCode, quarter) {
  const row = db.prepare(
    "SELECT locked_at FROM quarter_locks WHERE employee_code=? AND quarter=?"
  ).get(employeeCode, quarter);
  return !!(row?.locked_at);
}

// ── Auth Routes ─────────────────────────────────────────────────────────────

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Kullanıcı adı ve şifre gereklidir." });

  const u = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  }

  req.session.user = {
    id: u.id,
    username: u.username,
    role: u.role,
    employee_code: u.employee_code
  };
  audit(username, "login", "user", u.id);
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const actor = req.session.user?.username;
  req.session.destroy(() => {
    audit(actor, "logout");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ── Employee Routes ─────────────────────────────────────────────────────────

// GET /api/employee/goals?quarter=Q1
app.get("/api/employee/goals", requireRole("employee"), (req, res) => {
  const quarter = (req.query.quarter || "Q1").toUpperCase();
  const emp = req.session.user.employee_code;

  const rows = db.prepare(`
    SELECT g.*,
      u.actual, u.status, u.note, u.evidence_url, u.updated_at AS update_ts
    FROM goals g
      LEFT JOIN goal_updates u ON u.goal_id=g.id AND u.quarter=?
    WHERE g.employee_code=?
    ORDER BY COALESCE(g.kpi_no, 99), g.category, g.topic
  `).all(quarter, emp);

  const locked = isQuarterLocked(emp, quarter);
  res.json({ quarter, locked, goals: rows });
});

// PUT /api/employee/goals/:id/update
app.put("/api/employee/goals/:id/update", requireRole("employee"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Geçersiz hedef ID." });

  const { quarter, actual, status, note, evidence_url } = req.body || {};
  const q = String(quarter || "Q1").toUpperCase();
  if (!["Q1","Q2","Q3","Q4"].includes(q)) return res.status(400).json({ error: "Geçersiz çeyrek." });

  const emp = req.session.user.employee_code;

  // Validate goal belongs to employee
  const g = db.prepare("SELECT * FROM goals WHERE id=?").get(id);
  if (!g || g.employee_code !== emp) return res.status(404).json({ error: "Hedef bulunamadı." });

  // Validate evidence_url if provided
  if (evidence_url && evidence_url !== "") {
    try { new URL(evidence_url); } catch {
      return res.status(400).json({ error: "Geçersiz kanıt URL'si. Tam URL giriniz (https://…)." });
    }
  }

  // Check quarter lock
  if (isQuarterLocked(emp, q)) {
    return res.status(403).json({ error: `${q} çeyreği kilitli. Değişiklik yapılamaz.` });
  }

  const actor = req.session.user.username;
  const actualVal = (actual === "" || actual == null) ? null : Number(actual);

  db.prepare(`
    INSERT INTO goal_updates(goal_id, quarter, actual, status, note, evidence_url, updated_at, updated_by)
    VALUES(?,?,?,?,?,?,datetime('now'),?)
    ON CONFLICT(goal_id, quarter) DO UPDATE SET
      actual=excluded.actual,
      status=excluded.status,
      note=excluded.note,
      evidence_url=excluded.evidence_url,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by
  `).run(id, q, actualVal, status || null, note || null, evidence_url || null, actor);

  audit(actor, "update_goal", "goal_updates", `${id}:${q}`, `actual=${actual}`);
  res.json({ ok: true });
});

// GET /api/employee/summary
app.get("/api/employee/summary", requireRole("employee"), (req, res) => {
  const emp = req.session.user.employee_code;
  res.json(computeEmployeeSummary(db, emp));
});

// GET /api/employee/locks (which quarters are locked for me)
app.get("/api/employee/locks", requireRole("employee"), (req, res) => {
  const emp = req.session.user.employee_code;
  const rows = db.prepare(
    "SELECT quarter, locked_at, locked_by FROM quarter_locks WHERE employee_code=? AND locked_at IS NOT NULL"
  ).all(emp);
  const locks = {};
  for (const r of rows) locks[r.quarter] = { locked_at: r.locked_at, locked_by: r.locked_by };
  res.json({ locks });
});

// ── Moderator Routes ────────────────────────────────────────────────────────

// GET /api/moderator/employees – summary table
app.get("/api/moderator/employees", requireRole("moderator"), (req, res) => {
  const emps = db.prepare("SELECT * FROM employees WHERE code != 'NECMI' ORDER BY name").all();
  const list = emps.map(e => {
    const s = computeEmployeeSummary(db, e.code);
    return {
      code: e.code,
      name: e.name,
      title: e.title,
      Q1: s.quarters.Q1.total,
      Q2: s.quarters.Q2.total,
      Q3: s.quarters.Q3.total,
      Q4: s.quarters.Q4.total,
      H1: s.half_year.H1,
      H2: s.half_year.H2,
      annual_net_bonus: s.bonus.annual_net,
      annual_bonus: e.annual_bonus,
      net_salary: e.net_salary
    };
  });
  const manager = computeManagerSummary(db);
  res.json({ employees: list, manager });
});

// GET /api/moderator/employee/:code/summary – single employee detail
app.get("/api/moderator/employee/:code/summary", requireRole("moderator"), (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const summary = computeEmployeeSummary(db, code);
  res.json(summary);
});

// GET /api/moderator/employee/:code/goals?quarter=Q1
app.get("/api/moderator/employee/:code/goals", requireRole("moderator"), (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const quarter = String(req.query.quarter || "Q1").toUpperCase();

  const rows = db.prepare(`
    SELECT g.*,
      u.actual, u.status, u.note, u.evidence_url, u.updated_at AS update_ts, u.updated_by
    FROM goals g
      LEFT JOIN goal_updates u ON u.goal_id=g.id AND u.quarter=?
    WHERE g.employee_code=?
    ORDER BY COALESCE(g.kpi_no, 99), g.category, g.topic
  `).all(quarter, code);

  const locked = isQuarterLocked(code, quarter);
  res.json({ quarter, locked, goals: rows });
});

// PUT /api/moderator/goals/:id – update goal metadata + all 4 quarter targets
app.put("/api/moderator/goals/:id", requireRole("moderator"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Geçersiz hedef ID." });

  const body = req.body || {};
  const actor = req.session.user.username;

  const existing = db.prepare("SELECT id FROM goals WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Hedef bulunamadı." });

  const fields = [
    "category", "topic", "detail", "kpi_no", "measure_type",
    "target_q1", "target_q2", "target_q3", "target_q4"
  ];

  const sets = [];
  const vals = [];

  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
    sets.push(`${f}=?`);
    if (f.startsWith("target_") || f === "kpi_no") {
      vals.push(body[f] === "" || body[f] == null ? null : Number(body[f]));
    } else {
      vals.push(body[f] === "" ? null : body[f]);
    }
  }

  if (!sets.length) return res.json({ ok: true });

  sets.push("updated_at=datetime('now')", "updated_by=?");
  vals.push(actor, id);

  db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id=?`).run(...vals);
  audit(actor, "edit_goal", "goals", id, JSON.stringify(body));
  res.json({ ok: true });
});

// POST /api/moderator/goals – add new goal for employee
app.post("/api/moderator/goals", requireRole("moderator"), (req, res) => {
  const body = req.body || {};
  const actor = req.session.user.username;
  const { employee_code, category, topic, detail, kpi_no, measure_type,
    target_q1, target_q2, target_q3, target_q4 } = body;

  if (!employee_code || !topic) return res.status(400).json({ error: "employee_code ve topic zorunludur." });

  const numOrNull = v => (v === "" || v == null) ? null : Number(v);
  const result = db.prepare(`
    INSERT INTO goals(employee_code,category,topic,detail,kpi_no,measure_type,
      target_q1,target_q2,target_q3,target_q4,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    employee_code, category || "", topic, detail || "",
    numOrNull(kpi_no), measure_type || null,
    numOrNull(target_q1), numOrNull(target_q2), numOrNull(target_q3), numOrNull(target_q4),
    actor
  );

  audit(actor, "add_goal", "goals", result.lastInsertRowid, `emp=${employee_code}`);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// DELETE /api/moderator/goals/:id
app.delete("/api/moderator/goals/:id", requireRole("moderator"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Geçersiz hedef ID." });

  const actor = req.session.user.username;
  const existing = db.prepare("SELECT id FROM goals WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Hedef bulunamadı." });

  db.prepare("DELETE FROM goals WHERE id=?").run(id);
  audit(actor, "delete_goal", "goals", id);
  res.json({ ok: true });
});

// PUT /api/moderator/kpis/:employee/:kpiNo
app.put("/api/moderator/kpis/:employee/:kpiNo", requireRole("moderator"), (req, res) => {
  const employee = String(req.params.employee).toUpperCase();
  const kpiNo = Number(req.params.kpiNo);
  if (!Number.isInteger(kpiNo) || kpiNo <= 0) return res.status(400).json({ error: "Geçersiz KPI numarası." });

  const body = req.body || {};
  const actor = req.session.user.username;
  const n = v => (v == null || v === "") ? null : Number(v);

  const empExists = db.prepare("SELECT code FROM employees WHERE code=?").get(employee);
  if (!empExists) return res.status(404).json({ error: "Çalışan bulunamadı." });

  db.prepare(`
    UPDATE kpis SET
      title=COALESCE(?, title),
      weight=COALESCE(?, weight),
      target_q1=COALESCE(?, target_q1),
      target_q2=COALESCE(?, target_q2),
      target_q3=COALESCE(?, target_q3),
      target_q4=COALESCE(?, target_q4)
    WHERE employee_code=? AND kpi_no=?
  `).run(
    body.title ?? null,
    n(body.weight),
    n(body.target_q1), n(body.target_q2), n(body.target_q3), n(body.target_q4),
    employee, kpiNo
  );

  audit(actor, "edit_kpi", "kpis", `${employee}:${kpiNo}`, JSON.stringify(body));
  res.json({ ok: true });
});

// GET /api/moderator/kpis/:employee
app.get("/api/moderator/kpis/:employee", requireRole("moderator"), (req, res) => {
  const employee = String(req.params.employee).toUpperCase();
  const rows = db.prepare("SELECT * FROM kpis WHERE employee_code=? ORDER BY kpi_no").all(employee);
  res.json({ kpis: rows });
});

// PUT /api/moderator/manager-weights
app.put("/api/moderator/manager-weights", requireRole("moderator"), (req, res) => {
  const weights = req.body?.weights;
  if (!weights || typeof weights !== "object") return res.status(400).json({ error: "Geçersiz ağırlık verisi." });
  const actor = req.session.user.username;

  db.prepare(
    "INSERT INTO config(key,value_json) VALUES('manager_weights',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
  ).run(JSON.stringify(weights));

  audit(actor, "edit_manager_weights", "config", "manager_weights", JSON.stringify(weights));
  res.json({ ok: true });
});

// GET /api/moderator/quarter-locks/:employee
app.get("/api/moderator/quarter-locks/:employee", requireRole("moderator"), (req, res) => {
  const code = String(req.params.employee).toUpperCase();
  const rows = db.prepare(
    "SELECT quarter, locked_at, locked_by FROM quarter_locks WHERE employee_code=?"
  ).all(code);
  const locks = {};
  for (const r of rows) locks[r.quarter] = { locked_at: r.locked_at, locked_by: r.locked_by };
  res.json({ locks });
});

// PUT /api/moderator/quarter-locks/:employee/:quarter
app.put("/api/moderator/quarter-locks/:employee/:quarter", requireRole("moderator"), (req, res) => {
  const code = String(req.params.employee).toUpperCase();
  const quarter = String(req.params.quarter).toUpperCase();
  const { locked } = req.body || {};
  const actor = req.session.user.username;

  if (!["Q1","Q2","Q3","Q4"].includes(quarter)) return res.status(400).json({ error: "Geçersiz çeyrek." });

  if (locked) {
    db.prepare(`
      INSERT INTO quarter_locks(employee_code, quarter, locked_at, locked_by)
      VALUES(?,?,datetime('now'),?)
      ON CONFLICT(employee_code,quarter) DO UPDATE SET locked_at=datetime('now'), locked_by=excluded.locked_by
    `).run(code, quarter, actor);
    audit(actor, "lock_quarter", "quarter_locks", `${code}:${quarter}`);
  } else {
    db.prepare(
      "UPDATE quarter_locks SET locked_at=NULL, locked_by=NULL WHERE employee_code=? AND quarter=?"
    ).run(code, quarter);
    audit(actor, "unlock_quarter", "quarter_locks", `${code}:${quarter}`);
  }

  res.json({ ok: true });
});

// GET /api/moderator/export/summary.csv
app.get("/api/moderator/export/summary.csv", requireRole("moderator"), (req, res) => {
  const emps = db.prepare("SELECT * FROM employees WHERE code != 'NECMI' ORDER BY name").all();
  const header = ["Kod","Ad Soyad","Unvan","Q1","Q2","Q3","Q4","H1","H2","Yıllık Bonus Hak.","Yıllık Net Bonus"];
  const lines = ["\uFEFF" + header.join(";")]; // BOM for Excel

  for (const e of emps) {
    const s = computeEmployeeSummary(db, e.code);
    const row = [
      e.code, e.name, e.title,
      s.quarters.Q1.total ?? "",
      s.quarters.Q2.total ?? "",
      s.quarters.Q3.total ?? "",
      s.quarters.Q4.total ?? "",
      s.half_year.H1 ?? "",
      s.half_year.H2 ?? "",
      e.annual_bonus ?? 0,
      s.bonus.annual_net ?? 0
    ];
    lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="feltouch_kpi_ozet.csv"');
  res.send(lines.join("\r\n"));
});

// GET /api/health
app.get("/api/health", (_req, res) => res.json({ ok: true, db: DB_PATH }));

// Catch-all → login
app.get("*", (_req, res) => {
  res.redirect("/login.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Feltouch KPI] → http://localhost:${PORT}`));
