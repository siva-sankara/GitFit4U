const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
let accessToken: string | null = null;
try { accessToken = sessionStorage.getItem("gfu_access_token"); } catch { /* In-memory sessions still work when browser storage is unavailable. */ }
let refreshPromise: Promise<void> | null = null;
let authEpoch = 0;
const sessionChangeKey = "gfu-session-change";
const sessionMarker = () => { try { return localStorage.getItem(sessionChangeKey); } catch { return null; } };
function tokenIdentity(token: string | null) {
  if (!token) return null;
  try { const body = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return `${body.sub}:${body.sid}`; }
  catch { return token; }
}
export const getAccessToken = () => accessToken;
function applyAccessToken(token: string | null) {
  if (token === accessToken) return;
  const changedSession = tokenIdentity(token) !== tokenIdentity(accessToken);
  accessToken = token;
  try { token
    ? sessionStorage.setItem("gfu_access_token", token)
    : sessionStorage.removeItem("gfu_access_token"); } catch { /* Keep the current in-memory session. */ }
  window.dispatchEvent(
    new CustomEvent("gfu-auth", { detail: { token, changedSession } }),
  );
}
export function setAccessToken(token: string | null) {
  const changedSession = tokenIdentity(token) !== tokenIdentity(accessToken);
  authEpoch++;
  applyAccessToken(token);
  if (changedSession || !token) {
    // This marker carries no credential. Other tabs clear stale account data
    // and recover using the HttpOnly cookie when a protected page needs it.
    try { localStorage.setItem(sessionChangeKey, crypto.randomUUID()); } catch { /* Storage is optional. */ }
  }
}
window.addEventListener("storage", event => {
  if (event.key !== sessionChangeKey) return;
  authEpoch++;
  applyAccessToken(null);
});
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
type Options = RequestInit & { idempotencyKey?: string; responseType?: "blob" };
async function send<T>(
  path: string,
  options: Options,
  retry: boolean,
): Promise<T> {
  const controller = new AbortController();
  const tokenAtSend = accessToken;
  const epoch = authEpoch;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-csrf-protection": "1",
        ...(tokenAtSend ? { authorization: `Bearer ${tokenAtSend}` } : {}),
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
        ...options.headers,
      },
    });
    if (epoch !== authEpoch) throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
    if (response.ok && options.responseType === "blob") {
      if (!response.headers.get("content-type")?.startsWith("application/pdf"))
        throw new ApiError(response.status, "INVALID_DOWNLOAD", "The server did not return a valid invoice document.");
      return await response.blob() as T;
    }
    const raw = response.status === 204 ? "" : await response.text();
    let payload: any;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ApiError(
        response.status,
        "INVALID_RESPONSE",
        response.status === 429
          ? "Too many requests. Please wait and try again."
          : "The server returned an unexpected response.",
      );
    }
    if (!response.ok) {
      if (response.status === 401 && retry && !path.startsWith("/api/v1/auth/") &&
        ["AUTH_REQUIRED", "SESSION_EXPIRED", "INVALID_TOKEN"].includes(payload?.error?.code)) {
        if (accessToken === tokenAtSend) await refreshSession();
        if (epoch !== authEpoch || !accessToken)
          throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
        if (!["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase()) && !options.idempotencyKey)
          throw new ApiError(409, "AUTH_RETRY_REQUIRED", "Your session has been renewed. Please submit this action again.");
        return send<T>(path, options, false);
      }
      const validation = payload?.error?.details?.fieldErrors;
      const messages = validation ? Object.values(validation).flat().filter(Boolean).map(String) : [];
      const description = [...new Set([payload?.error?.message || "Request failed.", ...messages])].join(" ");
      throw new ApiError(
        response.status,
        payload?.error?.code || "REQUEST_FAILED",
        description,
        payload?.error?.requestId,
        payload?.error?.details,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      options.signal?.aborted
        ? "The request was cancelled. Check its current status before retrying."
        : controller.signal.aborted
        ? "The request timed out. Please retry."
        : "Unable to reach the server. Check your connection and retry.",
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
    window.clearTimeout(timeout);
  }
}
export async function refreshSession() {
  if (!refreshPromise) {
    const epoch = authEpoch;
    const marker = sessionMarker();
    const changed = () => epoch !== authEpoch || marker !== sessionMarker();
    const refresh = async () => {
      if (changed()) throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
      const result = await send<ApiEnvelope<{ accessToken: string }>>("/api/v1/auth/refresh", { method: "POST" }, false);
      if (changed()) throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
      if (!result?.data?.accessToken || typeof result.data.accessToken !== "string")
        throw new ApiError(502, "INVALID_RESPONSE", "Session recovery returned an unexpected response. Please retry.");
      applyAccessToken(result.data.accessToken);
    };
    // Web Locks coordinates tabs on this origin; the backend's atomic rotation
    // also covers browsers without Web Locks and independent PWA processes.
    refreshPromise = (navigator.locks?.request ? navigator.locks.request("gfu-session-refresh", refresh) : refresh())
      .catch(error => {
        if (!changed() && error instanceof ApiError && error.status === 401 &&
          ["REFRESH_REQUIRED", "INVALID_REFRESH_TOKEN", "SESSION_EXPIRED", "REFRESH_TOKEN_REUSE"].includes(error.code)) setAccessToken(null);
        throw error;
      }).finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}
export const apiRequest = <T>(path: string, options: Options = {}) =>
  send<T>(path, options, true);
export const apiDownload = (path: string) => send<Blob>(path, { responseType: "blob" }, true);
export interface ApiEnvelope<T> {
  success: true;
  message?: string;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
    hasMore?: boolean;
    nextCursor?: string;
    timezone?: string;
    serverNow?: string;
    eligibleGymCount?: number;
  };
}
