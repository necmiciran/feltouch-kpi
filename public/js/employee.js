import { api } from "./api.js";
import { fmt, tl, scoreClass, fillClass, esc, toast, statusBadge, qPills, computeSuccess } from "./utils.js";

const $ = id => document.getElementById(id);

let currentQ = "Q1";
let allGoals  = [];
let locked    = false;
let summary   = null;

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const me = await api("/api/me");
    if (me.user.role !== "employee") { location.href = "/moderator.html"; return; }
    $("who").textContent = `${me.user.username} · ${me.user.employee_code}`;
  } catch {
    location.href = "/login.html";
    return;
  }
  await load();
}

// ── Load All Data ────────────────────────────────────────────────────────────

async function load() {
  await Promise.all([loadGoals(), loadSummary()]);
}

async function loadGoals() {
  try {
    const data = await api(`/api/employee/goals?quarter=${currentQ}`);
    allGoals = data.goals || [];
    locked   = !!data.locked;
    renderLockBadge();
    renderGoalsTable();
  } catch (e) {
    toast("Hedefler yüklenemedi: " + e.message, "error");
  }
}

async function loadSummary() {
  try {
    summary = await api("/api/employee/summary");
    renderScoreCards();
    renderKpiCards();
  } catch (e) {
    toast("Özet yüklenemedi: " + e.message, "error");
  }
}

// ── Quarter Switcher ─────────────────────────────────────────────────────────

document.querySelectorAll(".q-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentQ = btn.dataset.q;
    updateQSwitcher();
    await load();
  });
});

function updateQSwitcher() {
  document.querySelectorAll(".q-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.q === currentQ);
  });
}
updateQSwitcher();

// ── Lock Badge ───────────────────────────────────────────────────────────────

function renderLockBadge() {
  $("lock-badge").style.display = locked ? "inline-flex" : "none";
}

// ── Score Cards ───────────────────────────────────────────────────────────────

function renderScoreCards() {
  if (!summary) return;
  const qData = summary.quarters[currentQ];
  const score = qData?.total;

  const el = $("q-score");
  el.textContent = score == null ? "–" : fmt(score, 1);
  el.className = `value mono ${scoreClass(score)}`;
  $("q-label").textContent = currentQ + " · " + (locked ? "🔒 Kilitli" : "Düzenlenebilir");

  const h1 = summary.half_year.H1;
  const h2 = summary.half_year.H2;
  const el1 = $("h1-score");
  const el2 = $("h2-score");
  el1.textContent = h1 == null ? "–" : fmt(h1, 1);
  el2.textContent = h2 == null ? "–" : fmt(h2, 1);
  el1.className = `value mono ${scoreClass(h1)}`;
  el2.className = `value mono ${scoreClass(h2)}`;

  const bn = summary.bonus;
  $("bonus-annual").textContent = tl(bn.annual_net);
  $("bonus-detail").textContent =
    `H1: ${tl(bn.H1_net)} · H2: ${tl(bn.H2_net)} · Hak: ${tl(bn.annual_bonus)}`;
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function renderKpiCards() {
  if (!summary) return;
  const qData = summary.quarters[currentQ];
  const grid  = $("kpi-grid");

  if (!qData?.perKpi?.length) { grid.innerHTML = ""; return; }

  grid.innerHTML = qData.perKpi.map(k => {
    const score = k.score;
    const pct   = score == null ? 0 : Math.min(score, 100);
    const fc    = fillClass(score);
    const sc    = scoreClass(score);
    return `
      <div class="kpi-card">
        <div class="kpi-head">
          <div>
            <div class="kpi-title">${esc(k.title)}</div>
            <div class="kpi-weight">Ağırlık: %${k.weight}</div>
          </div>
          <div class="kpi-no">KPI ${k.kpi_no}</div>
        </div>
        <div class="kpi-score mono ${sc}">${score == null ? "N/A" : fmt(score, 1)}</div>
        <div class="progress-bar">
          <div class="progress-fill ${fc}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// ── Goals Table ───────────────────────────────────────────────────────────────

function getFilters() {
  return {
    search:  $("f-search").value.toLowerCase(),
    kpi:     $("f-kpi").value,
    status:  $("f-status").value,
    active:  $("f-active").checked,
  };
}

function filterGoals(goals, f) {
  return goals.filter(g => {
    const target = ({Q1:g.target_q1,Q2:g.target_q2,Q3:g.target_q3,Q4:g.target_q4})[currentQ];
    const hasTarget = target != null && target !== 0;

    if (f.active && !hasTarget) return false;

    if (f.kpi !== "") {
      if (f.kpi === "0" && g.kpi_no != null) return false;
      if (f.kpi !== "0" && String(g.kpi_no) !== f.kpi) return false;
    }

    if (f.status && (g.status || "") !== f.status) return false;

    if (f.search) {
      const hay = ((g.topic || "") + " " + (g.category || "") + " " + (g.detail || "")).toLowerCase();
      if (!hay.includes(f.search)) return false;
    }

    return true;
  });
}

function buildGoalRow(g) {
  const target = ({Q1:g.target_q1,Q2:g.target_q2,Q3:g.target_q3,Q4:g.target_q4})[currentQ];
  const hasTarget = target != null && Number(target) !== 0;
  const actual    = g.actual;
  const successR  = hasTarget ? computeSuccess(actual, target) : null;
  const successPct = successR == null ? null : Math.round(successR * 1000) / 10;
  const sc = scoreClass(successPct);
  const isNA = !hasTarget;

  const targetDisp  = isNA ? `<span class="tiny">N/A</span>` : fmt(target, target % 1 === 0 ? 0 : 2);
  const successDisp = isNA ? `<span class="tiny">N/A</span>` : `<span class="${sc}">${fmt(successPct, 1)}</span>`;
  const rowCls      = isNA ? "tr-inactive" : "";

  const kpiDisp = g.kpi_no
    ? `<span class="pill" style="font-family:var(--mono)">${g.kpi_no}</span>`
    : `<span class="tiny" style="color:var(--text3)">—</span>`;

  return `
    <tr class="${rowCls}" data-id="${g.id}">
      <td>${kpiDisp}</td>
      <td>
        <div style="font-weight:600;font-size:0.82rem;">${esc(g.topic)}</div>
        <div class="small">${esc(g.category)}${g.detail ? " · " + esc(g.detail) : ""}</div>
      </td>
      <td>${qPills(g, currentQ)}</td>
      <td class="mono">${targetDisp}</td>
      <td>
        <input class="actual-input w80" data-id="${g.id}"
          value="${actual ?? ""}"
          type="number" step="any"
          placeholder="–"
          ${locked || isNA ? "disabled" : ""}
          ${isNA ? 'title="Bu çeyrekte hedef yok"' : ""} />
      </td>
      <td class="mono center">${successDisp}</td>
      <td>
        <select class="status-sel" data-id="${g.id}" ${locked ? "disabled" : ""}>
          ${["","Planlandı","Devam Ediyor","Tamamlandı","İptal"]
            .map(s => `<option ${(g.status||"")===s?"selected":""}>${s}</option>`)
            .join("")}
        </select>
      </td>
      <td>
        <input class="evidence-input w200" data-id="${g.id}"
          value="${esc(g.evidence_url ?? "")}"
          placeholder="https://drive.google.com/…"
          ${locked ? "disabled" : ""} />
      </td>
      <td>
        <input class="note-input w140" data-id="${g.id}"
          value="${esc(g.note ?? "")}"
          placeholder="kısa not"
          ${locked ? "disabled" : ""} />
      </td>
      <td>
        <button class="sm save-btn" data-id="${g.id}" ${locked || isNA ? "disabled" : ""}>
          Kaydet
        </button>
      </td>
    </tr>
  `;
}

function bindGoalEvents(tbody) {
  tbody.querySelectorAll(".save-btn").forEach(btn => {
    btn.addEventListener("click", () => saveGoal(btn.dataset.id));
  });
  tbody.querySelectorAll(".actual-input").forEach(inp => {
    inp.addEventListener("input", () => updateSuccessDisplay(inp));
  });
}

function renderGoalsTable() {
  const f = getFilters();
  const tbody = $("goals-body");

  const filtered = filterGoals(allGoals, f);

  $("goal-count").textContent = `${filtered.length} hedef gösteriliyor`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="icon">🎯</div>Hedef bulunamadı</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(buildGoalRow).join("");
  bindGoalEvents(tbody);
}

function updateSuccessDisplay(inp) {
  const id   = inp.dataset.id;
  const goal = allGoals.find(g => String(g.id) === id);
  if (!goal) return;
  const target = ({Q1:goal.target_q1,Q2:goal.target_q2,Q3:goal.target_q3,Q4:goal.target_q4})[currentQ];
  const actual = inp.value;
  const s = computeSuccess(actual, target);
  const pct = s == null ? null : Math.round(s * 1000) / 10;
  // find cell
  const row = inp.closest("tr");
  if (!row) return;
  const cells = row.querySelectorAll("td");
  if (cells[5]) {
    cells[5].innerHTML = pct == null
      ? `<span class="tiny">N/A</span>`
      : `<span class="${scoreClass(pct)}">${fmt(pct, 1)}</span>`;
  }
}

async function saveGoal(id) {
  const actual      = document.querySelector(`.actual-input[data-id="${id}"]`)?.value;
  const status      = document.querySelector(`.status-sel[data-id="${id}"]`)?.value;
  const evidence_url = document.querySelector(`.evidence-input[data-id="${id}"]`)?.value;
  const note        = document.querySelector(`.note-input[data-id="${id}"]`)?.value;

  const btn = document.querySelector(`.save-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "…"; }

  try {
    await api(`/api/employee/goals/${id}/update`, {
      method: "PUT",
      body: { quarter: currentQ, actual, status, evidence_url, note }
    });
    toast("✓ Kaydedildi", "success");
    await load();
  } catch (e) {
    toast("Hata: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Kaydet"; }
  }
}

// ── Filter listeners ──────────────────────────────────────────────────────────

["f-search","f-kpi","f-status","f-active"].forEach(id => {
  $( id).addEventListener(id === "f-active" ? "change" : "input", renderGoalsTable);
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────

$("btn-refresh").addEventListener("click", load);
$("btn-logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.href = "/login.html";
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
