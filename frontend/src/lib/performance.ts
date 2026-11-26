const API_BASE = (
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const USER_TOKEN_KEY = "yakodonyo_auth_token";

const ALLOWED_FIELDS = new Set([
  "kind",
  "stage",
  "status",
  "engine",
  "language",
  "engine_used",
  "cache_hit",
  "ok",
]);

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    if (token) return { Authorization: `Bearer ${token}` };
    const key = process.env.NEXT_PUBLIC_API_KEY;
    return key ? { Authorization: `Bearer ${key}` } : {};
  } catch {
    return {};
  }
}

/** Fire-and-forget browser timing sample. Never blocks or fails the user action. */
export function reportMetric(
  event: string,
  durationMs: number,
  fields: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined" || !Number.isFinite(durationMs) || durationMs < 0) return;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key)) safe[key] = value;
  }
  try {
    void fetch(`${API_BASE}/api/v1/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ event, duration_ms: durationMs, fields: safe }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Metrics are best-effort.
  }
}

/** Measure an async operation and report its duration. */
export async function measured<T>(
  event: string,
  fields: Record<string, string | number | boolean>,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    reportMetric(event, performance.now() - start, fields);
  }
}
