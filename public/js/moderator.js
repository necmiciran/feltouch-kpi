import { api } from "./api.js";
import { fmt, tl, scoreClass, fillClass, esc, toast, computeSuccess } from "./utils.js";

const $ = id => document.getElementById(id);

let currentEmp  = null; // currently open employee code
let currentQ    = "Q1"; // selected quarter in detail panel
let detailGoals = [];
let locks       = {};   // { Q1: {locked_at, locked_by}, ... }
let empSummary  = null;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const me = await api("/api/me");
    if (me.user.role !== "moderator") { location.href = "/employee.html"; return; }
    $("who").textContent = me.user.username;
  } catch {
    location.href = "/login.html";
    return;
  }
  await loadTeam();
}

// ── Team Summary ──────────────────────────────────────────────────────────────

async function loadTeam() {
  try {
    const data = await api("/api/moderator/employees");
    renderTeamTable(data.employees);
    renderManagerPanel(data.manager);
  } catch (e) {
    toast("Ekip verisi yüklenemedi: " + e.message, "error");
  }
}

function scoreCell(v) {
  const cls = scoreClass(v);
  return `<td class="mono center ${cls}">${v == null ? "–" : fmt(v, 1)}</td>`;
}

function renderTeamTable(emps) {
  const tbody = $("team-body");
  if (!emps?.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="icon">👥</div>Çalışan bulunamadı</div></td></tr>`;
    return;
  }

  tbody.innerHTML = emps.map(e => `
    <tr>
      <td>
        <div style="font-weight:700">${esc(e.name)}</div>
        <div class="tiny">${esc(e.code)}</div>
      </td>
      <td class="small muted">${esc(e.title)}</td>
      ${scoreCell(e.Q1)}
      ${scoreCell(e.Q2)}
      ${scoreCell(e.Q3)}
      ${scoreCell(e.Q4)}
      ${scoreCell(e.H1)}
      ${scoreCell(e.H2)}
      <td class="mono right">${tl(e.net_salary)}</td>
      <td class="mono right">${tl(e.annual_net_bonus)}</td>
      <td>
        <button class="sm open-detail" data-code="${esc(e.code)}">Detay →</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".open-detail").forEach(btn => {
    btn.addEventListener("click", () => openEmployee(btn.dataset.code));
  });
}

function renderManagerPanel(mgr) {
  if (!mgr) return;
  const ws = mgr.weights || {};
  const qs = mgr.qScores || {};
  const qn = mgr.qBonus?.net || {};

  const wStr = Object.entries(ws)
    .map(([k, v]) => `<strong>${k}</strong>: %${Math.round(v * 100)}`)
    .join(" · ");

  const qStr = ["Q1","Q2","Q3","Q4"]
    .map(q => `<strong>${q}</strong>: ${qs[q] == null ? "–" : fmt(qs[q],1)} → ${tl(qn[q] ?? 0)}`)
    .join(" &nbsp;|&nbsp; ");

  $("mgr-content").innerHTML =
    `<div style="margin-bottom:6px;">Ekip ağırlıkları: ${wStr}</div>` +
    `<div>Çeyrek skor → Bonus: ${qStr}</div>` +
    `<div style="margin-top:6px;font-weight:700;">Toplam yıllık net bonus: ${tl(mgr.qBonus?.total ?? 0)}</div>`;
}

// ── Employee Detail ───────────────────────────────────────────────────────────

async function openEmployee(code) {
  currentEmp = code;
  currentQ   = "Q1";
  updateDetailQSwitcher();
  $("detail-section").style.display = "block";
  $("detail-section").scrollIntoView({ behavior: "smooth" });

  await Promise.all([loadDetailSummary(), loadDetailGoals(), loadLocks()]);
}

async function loadDetailSummary() {
  try {
    empSummary = await api(`/api/moderator/employee/${currentEmp}/summary`);
    $("detail-title").textContent = empSummary.name || currentEmp;
    $("detail-subtitle").textContent = empSummary.title || "";
    renderDetailKpiCards();
  } catch {}
}

function renderDetailKpiCards() {
  if (!empSummary) return;
  const qData = empSummary.quarters?.[currentQ];
  const grid  = $("detail-kpi-grid");
  if (!qData?.perKpi?.length) { grid.innerHTML = ""; return; }

  grid.innerHTML = qData.perKpi.map(k => {
    const score = k.score;
    const pct   = score == null ? 0 : Math.min(score, 100);
    return `
      <div class="kpi-card">
        <div class="kpi-head">
          <div>
            <div class="kpi-title">${esc(k.title)}</div>
            <div class="kpi-weight">%${k.weight} ağırlık</div>
          </div>
          <div class="kpi-no">KPI ${k.kpi_no}</div>
        </div>
        <div class="kpi-score mono ${scoreClass(score)}">${score == null ? "N/A" : fmt(score, 1)}</div>
        <div class="progress-bar">
          <div class="progress-fill ${fillClass(score)}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

async function loadDetailGoals() {
  try {
    const data = await api(`/api/moderator/employee/${currentEmp}/goals?quarter=${currentQ}`);
    detailGoals = data.goals || [];
    renderDetailTable();
    renderCategoryFilter();
  } catch (e) {
    toast("Hedefler yüklenemedi: " + e.message, "error");
  }
}

async function loadLocks() {
  try {
    const data = await api(`/api/moderator/quarter-locks/${currentEmp}`);
    locks = data.locks || {};
    renderLockControls();
    updateDetailQSwitcher();
  } catch {}
}

// ── Quarter Switcher (detail) ─────────────────────────────────────────────────

document.querySelectorAll("#detail-q-switcher .q-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentQ = btn.dataset.q;
    updateDetailQSwitcher();
    await Promise.all([loadDetailSummary(), loadDetailGoals()]);
  });
});

function updateDetailQSwitcher() {
  document.querySelectorAll("#detail-q-switcher .q-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.q === currentQ);
    b.classList.toggle("locked-q", !!locks[b.dataset.q]?.locked_at);
  });
}

// ── Lock Controls ─────────────────────────────────────────────────────────────

function renderLockControls() {
  const container = $("lock-controls");
  const qs = ["Q1","Q2","Q3","Q4"];
  // Keep the label span, rebuild buttons
  let html = `<span class="tiny" style="margin-right:4px;">Çeyrek kilidi:</span>`;
  for (const q of qs) {
    const isLocked = !!locks[q]?.locked_at;
    const lockedBy = locks[q]?.locked_by || "";
    const title = isLocked ? `${q} kilitli · ${lockedBy} tarafından` : `${q} kilitle`;
    html += `
      <button class="sm ${isLocked ? "danger-btn" : ""} lock-btn"
        data-q="${q}" data-locked="${isLocked ? "1" : "0"}"
        title="${esc(title)}">
        ${isLocked ? "🔒" : "🔓"} ${q}
      </button>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll(".lock-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleLock(btn.dataset.q, btn.dataset.locked === "1"));
  });
}

async function toggleLock(quarter, isCurrentlyLocked) {
  const newLocked = !isCurrentlyLocked;
  const label = newLocked ? "kilitlenecek" : "kilidi açılacak";
  if (!confirm(`${quarter} çeyreği ${label}. Onaylıyor musunuz?`)) return;

  try {
    await api(`/api/moderator/quarter-locks/${currentEmp}/${quarter}`, {
      method: "PUT",
      body: { locked: newLocked }
    });
    toast(`${quarter} ${newLocked ? "kilitlendi" : "kilidi açıldı"}`, "success");
    await loadLocks();
  } catch (e) {
    toast("Hata: " + e.message, "error");
  }
}

// ── Category Filter Population ────────────────────────────────────────────────

function renderCategoryFilter() {
  const cats = [...new Set(detailGoals.map(g => g.category).filter(Boolean))].sort();
  const sel = $("detail-f-cat");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Tüm Kategoriler</option>` +
    cats.map(c => `<option ${c === cur ? "selected" : ""} value="${esc(c)}">${esc(c)}</option>`).join("");
}

// ── Goal Detail Table ─────────────────────────────────────────────────────────

function getDetailFilters() {
  return {
    search: $("detail-search").value.toLowerCase(),
    kpi:    $("detail-f-kpi").value,
    cat:    $("detail-f-cat").value,
  };
}

function renderDetailTable() {
  const f = getDetailFilters();
  let goals = detailGoals.filter(g => {
    if (f.kpi !== "") {
      if (f.kpi === "0" && g.kpi_no != null) return false;
      if (f.kpi !== "0" && String(g.kpi_no) !== f.kpi) return false;
    }
    if (f.cat && g.category !== f.cat) return false;
    if (f.search) {
      const hay = ((g.topic||"")+" "+(g.category||"")+" "+(g.detail||"")).toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });

  const tbody = $("detail-body");
  if (!goals.length) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="icon">🎯</div>Hedef bulunamadı</div></td></tr>`;
    return;
  }

  const isLocked = !!locks[currentQ]?.locked_at;

  tbody.innerHTML = goals.map(g => {
    const curTarget = ({Q1:g.target_q1,Q2:g.target_q2,Q3:g.target_q3,Q4:g.target_q4})[currentQ];
    const actual    = g.actual;
    const s         = computeSuccess(actual, curTarget);
    const sPct      = s == null ? null : Math.round(s * 1000) / 10;
    const sc        = scoreClass(sPct);

    return `
      <tr data-id="${g.id}">
        <td class="mono tiny">${g.id}</td>
        <td>
          <input class="w60 kpi-inp" data-id="${g.id}"
            value="${g.kpi_no ?? ""}" placeholder="1–5" type="number" min="1" max="5" />
        </td>
        <td>
          <select class="mt-sel" data-id="${g.id}">
            <option value="" ${!g.measure_type?"selected":""}>—</option>
            <option value="count"  ${g.measure_type==="count" ?"selected":""}>Adet</option>
            <option value="ratio"  ${g.measure_type==="ratio" ?"selected":""}>Oran %</option>
            <option value="score"  ${g.measure_type==="score" ?"selected":""}>Puan</option>
          </select>
        </td>
        <td>
          <input class="w140 cat-inp" data-id="${g.id}" value="${esc(g.category??"")}"/>
        </td>
        <td>
          <div style="font-weight:600;font-size:0.82rem;">${esc(g.topic)}</div>
          <div class="small muted">${esc(g.detail??'')}</div>
        </td>
        <!-- 4 quarter target inputs -->
        <td style="background:rgba(224,156,48,0.04);border-left:1px solid var(--border2);">
          <input class="w60 tq1-inp" data-id="${g.id}" type="number" step="any"
            value="${g.target_q1 ?? ""}" placeholder="Q1"
            title="Q1 hedef" />
        </td>
        <td style="background:rgba(224,156,48,0.04);">
          <input class="w60 tq2-inp" data-id="${g.id}" type="number" step="any"
            value="${g.target_q2 ?? ""}" placeholder="Q2"
            title="Q2 hedef" />
        </td>
        <td style="background:rgba(224,156,48,0.04);">
          <input class="w60 tq3-inp" data-id="${g.id}" type="number" step="any"
            value="${g.target_q3 ?? ""}" placeholder="Q3"
            title="Q3 hedef" />
        </td>
        <td style="background:rgba(224,156,48,0.04);">
          <input class="w60 tq4-inp" data-id="${g.id}" type="number" step="any"
            value="${g.target_q4 ?? ""}" placeholder="Q4"
            title="Q4 hedef" />
        </td>
        <td class="mono small ${sc}">${actual != null ? fmt(actual, 1) : "—"}</td>
        <td class="small muted">${g.status || "—"}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="sm save-goal-btn" data-id="${g.id}">Kaydet</button>
            <button class="sm danger-btn del-goal-btn" data-id="${g.id}" title="Sil">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Bind save buttons
  tbody.querySelectorAll(".save-goal-btn").forEach(btn => {
    btn.addEventListener("click", () => saveGoal(btn.dataset.id));
  });

  // Bind delete buttons
  tbody.querySelectorAll(".del-goal-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteGoal(btn.dataset.id));
  });
}

async function saveGoal(id) {
  const kpi_no      = document.querySelector(`.kpi-inp[data-id="${id}"]`)?.value;
  const measure_type = document.querySelector(`.mt-sel[data-id="${id}"]`)?.value;
  const category    = document.querySelector(`.cat-inp[data-id="${id}"]`)?.value;
  const target_q1   = document.querySelector(`.tq1-inp[data-id="${id}"]`)?.value;
  const target_q2   = document.querySelector(`.tq2-inp[data-id="${id}"]`)?.value;
  const target_q3   = document.querySelector(`.tq3-inp[data-id="${id}"]`)?.value;
  const target_q4   = document.querySelector(`.tq4-inp[data-id="${id}"]`)?.value;

  const btn = document.querySelector(`.save-goal-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "…"; }

  try {
    await api(`/api/moderator/goals/${id}`, {
      method: "PUT",
      body: { kpi_no, measure_type, category, target_q1, target_q2, target_q3, target_q4 }
    });
    toast("✓ Kaydedildi", "success");
    await Promise.all([loadDetailSummary(), loadDetailGoals(), loadTeam()]);
  } catch (e) {
    toast("Hata: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Kaydet"; }
  }
}

async function deleteGoal(id) {
  if (!confirm("Bu hedef silinecek. Emin misiniz?")) return;
  try {
    await api(`/api/moderator/goals/${id}`, { method: "DELETE" });
    toast("Hedef silindi", "success");
    await Promise.all([loadDetailGoals(), loadTeam()]);
  } catch (e) {
    toast("Hata: " + e.message, "error");
  }
}

// ── Detail filters ────────────────────────────────────────────────────────────

["detail-search","detail-f-kpi","detail-f-cat"].forEach(id => {
  $(id).addEventListener("input", renderDetailTable);
});

// ── Close detail ──────────────────────────────────────────────────────────────

$("btn-close-detail").addEventListener("click", () => {
  $("detail-section").style.display = "none";
  currentEmp = null;
});

// ── Add Goal Modal ────────────────────────────────────────────────────────────

$("btn-add-goal").addEventListener("click", () => {
  if (!currentEmp) return;
  clearAddGoalModal();
  $("add-goal-modal").style.display = "flex";
});

function closeAddModal() {
  $("add-goal-modal").style.display = "none";
}

$("add-goal-close").addEventListener("click", closeAddModal);
$("add-goal-cancel").addEventListener("click", closeAddModal);

function clearAddGoalModal() {
  ["ag-category","ag-topic","ag-detail","ag-annual","ag-tq1","ag-tq2","ag-tq3","ag-tq4"].forEach(id => {
    $(id).value = "";
  });
  $("ag-kpi").value = "";
  $("ag-measure").value = "";
}

// Distribution templates
const TEMPLATES = {
  even:  [0.25, 0.25, 0.25, 0.25],
  front: [0.40, 0.30, 0.20, 0.10],
  mid:   [0.00, 0.50, 0.50, 0.00],
  q1:    [1.00, 0.00, 0.00, 0.00],
  q2:    [0.00, 1.00, 0.00, 0.00],
  q3:    [0.00, 0.00, 1.00, 0.00],
  q4:    [0.00, 0.00, 0.00, 1.00],
  h1:    [0.50, 0.50, 0.00, 0.00],
  h2:    [0.00, 0.00, 0.50, 0.50],
};

document.querySelectorAll(".tpl-btn").forEach(btn => {
  btn.addEventListener("click", () => applyTemplate(btn.dataset.tpl));
});

function applyTemplate(tpl) {
  const factors = TEMPLATES[tpl];
  if (!factors) return;
  const annual = parseFloat($("ag-annual").value) || null;
  const inputs = ["ag-tq1","ag-tq2","ag-tq3","ag-tq4"];
  factors.forEach((f, i) => {
    $(inputs[i]).value = annual ? (annual > 0 ? Math.round(annual * f * 10) / 10 : "") : (f > 0 ? "" : "");
    if (annual && f > 0) $(inputs[i]).value = Math.round(annual * f * 10) / 10;
    else if (!annual) $(inputs[i]).value = "";
  });
  // mark active quarters only
  if (!annual) {
    factors.forEach((f, i) => {
      $(inputs[i]).value = f > 0 ? "" : ""; // keeps blanks, no auto-fill without annual
    });
    toast("Yıllık toplam hedef girin, şablon değerleri otomatik hesaplanır.", "");
  }
}

$("add-goal-save").addEventListener("click", async () => {
  const topic = $("ag-topic").value.trim();
  if (!topic) { toast("Konu zorunludur.", "error"); return; }

  const btn = $("add-goal-save");
  btn.disabled = true;
  try {
    await api("/api/moderator/goals", {
      method: "POST",
      body: {
        employee_code: currentEmp,
        category:     $("ag-category").value.trim(),
        topic,
        detail:       $("ag-detail").value.trim(),
        kpi_no:       $("ag-kpi").value,
        measure_type: $("ag-measure").value,
        target_q1:    $("ag-tq1").value,
        target_q2:    $("ag-tq2").value,
        target_q3:    $("ag-tq3").value,
        target_q4:    $("ag-tq4").value,
      }
    });
    toast("✓ Hedef eklendi", "success");
    closeAddModal();
    await Promise.all([loadDetailGoals(), loadTeam()]);
  } catch (e) {
    toast("Hata: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// ── Manager Weights Modal ─────────────────────────────────────────────────────

$("btn-mgr-edit").addEventListener("click", openMgrModal);
$("mgr-modal-close").addEventListener("click", closeMgrModal);
$("mgr-modal-close2").addEventListener("click", closeMgrModal);

const MGR_EMPS = ["YIGIT","SENA","ASLI","EMRULLAH"];

async function openMgrModal() {
  let weights = {};
  try {
    const data = await api("/api/moderator/employees");
    weights = data.manager?.weights || {};
  } catch {}

  const form = $("mgr-weights-form");
  form.innerHTML = MGR_EMPS.map(code => `
    <div class="form-group">
      <label>${code}</label>
      <input id="mw-${code}" type="number" step="0.01" min="0" max="1"
        value="${fmt(weights[code] ?? 0, 2)}" />
    </div>
  `).join("");

  $("mgr-modal").style.display = "flex";
}

function closeMgrModal() { $("mgr-modal").style.display = "none"; }

$("mgr-save").addEventListener("click", async () => {
  const weights = {};
  for (const code of MGR_EMPS) {
    const v = parseFloat($(`mw-${code}`)?.value);
    if (!isNaN(v)) weights[code] = v;
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.01) {
    toast(`Ağırlıklar toplamı 1.00 olmalıdır. Şu an: ${sum.toFixed(2)}`, "error");
    return;
  }
  try {
    await api("/api/moderator/manager-weights", { method: "PUT", body: { weights } });
    toast("✓ Ağırlıklar güncellendi", "success");
    closeMgrModal();
    await loadTeam();
  } catch (e) {
    toast("Hata: " + e.message, "error");
  }
});

// ── Toolbar ───────────────────────────────────────────────────────────────────

$("btn-refresh").addEventListener("click", async () => {
  await loadTeam();
  if (currentEmp) await Promise.all([loadDetailSummary(), loadDetailGoals(), loadLocks()]);
});

$("btn-logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.href = "/login.html";
});

// ── Start ─────────────────────────────────────────────────────────────────────
init();
