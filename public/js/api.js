/**
 * Lightweight API wrapper.
 * Throws on non-2xx with parsed error message.
 */
export async function api(path, { method = "GET", body = null } = {}) {
  const opts = {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(path, opts);

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}
