/** Format number to fixed decimals; returns "–" for null/NaN. */
export function fmt(v, digits = 1) {
  if (v == null || Number.isNaN(Number(v))) return "–";
  return Number(v).toFixed(digits);
}

/** Format as percent string. */
export function pct(v, digits = 0) {
  if (v == null || Number.isNaN(Number(v))) return "–";
  return (Number(v) * 100).toFixed(digits) + "%";
}

/** Format Turkish currency. */
export function tl(v) {
  if (v == null) return "–";
  return Number(v).toLocaleString("tr-TR") + " ₺";
}

/**
 * Return CSS class based on score (0–100).
 * high ≥ 80, mid ≥ 50, low < 50, null if no value.
 */
export function scoreClass(v) {
  if (v == null) return "score-null";
  if (v >= 80) return "score-high";
  if (v >= 50) return "score-mid";
  return "score-low";
}

export function fillClass(v) {
  if (v == null) return "fill-mid";
  if (v >= 80) return "fill-high";
  if (v >= 50) return "fill-mid";
  return "fill-low";
}

/** Escape HTML to prevent XSS. */
export function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Show a toast notification. type = 'success' | 'error' | '' */
export function toast(msg, type = "") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Status badge HTML */
export function statusBadge(s) {
  const map = {
    "Tamamlandı":   "success",
    "Devam Ediyor": "info",
    "Planlandı":    "warning",
    "İptal":        "danger",
  };
  const cls = map[s] || "";
  return s ? `<span class="pill ${cls}">${esc(s)}</span>` : "";
}

/** Quarter activity pills HTML */
export function qPills(goal, currentQ) {
  const qs = ["Q1","Q2","Q3","Q4"];
  const targets = {
    Q1: goal.target_q1, Q2: goal.target_q2,
    Q3: goal.target_q3, Q4: goal.target_q4
  };
  return `<div class="q-pills">${qs.map(q => {
    const hasTarget = targets[q] != null && targets[q] !== 0;
    const cls = q === currentQ && hasTarget ? "current"
              : hasTarget ? "active"
              : "inactive";
    return `<span class="q-pill ${cls}" title="${q}: ${hasTarget ? targets[q] : 'N/A'}">${q.replace("Q","")}</span>`;
  }).join("")}</div>`;
}

/** Compute success ratio for display. */
export function computeSuccess(actual, target) {
  if (target == null || Number(target) === 0) return null;
  if (actual == null || actual === "") return 0;
  return Math.min(Number(actual) / Number(target), 1);
}

/** Group array by keyFn. */
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
