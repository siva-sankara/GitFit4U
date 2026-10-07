import { API_URL } from "./runtimeConfig";
let accessToken: string | null = null;
try { accessToken = sessionStorage.getItem("gfu_access_token"); } catch { /* In-memory sessions still work when browser storage is unavailable. */ }
let refreshPromise: Promise<void> | null = null;
let pendingLogoutPromise: Promise<void> | null = null;
let authEpoch = 0;
const sessionChangeKey = "gfu-session-change";
const durableSessionKey = "gfu-has-session";
const pendingLogoutKey = "gfu-pending-logout";
const sessionMarker = () => { try { return localStorage.getItem(sessionChangeKey); } catch { return null; } };
const readLocal = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, value: string | null) => {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); }
  catch { /* Browser storage is an optimization, never an auth boundary. */ }
};
function emitSessionDiagnostic(event: string, error?: unknown) {
  const failure = error && typeof error === "object"
    ? error as { status?: unknown; code?: unknown; requestId?: unknown }
    : undefined;
  const detail = {
    event,
    at: new Date().toISOString(),
    online: navigator.onLine,
    visibility: document.visibilityState,
    ...(typeof failure?.status === "number" ? { status: failure.status } : {}),
    ...(typeof failure?.code === "string" ? { code: failure.code } : {}),
    ...(typeof failure?.requestId === "string" ? { requestId: failure.requestId } : {}),
  };
  window.dispatchEvent(new CustomEvent("gfu-session-diagnostic", { detail }));
  if (import.meta.env.DEV) console.info("[GETFIT4U session]", detail);
}
if (accessToken) writeLocal(durableSessionKey, "1");
function tokenIdentity(token: string | null) {
  if (!token) return null;
  try { const body = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return `${body.sub}:${body.sid}`; }
  catch { return token; }
}
export const getAccessToken = () => accessToken;
/** A non-secret hint used only to decide whether an HttpOnly-cookie recovery is worthwhile. */
export const hasPersistedSession = () => Boolean(accessToken || readLocal(durableSessionKey));
export const hasPendingLogout = () => Boolean(readLocal(pendingLogoutKey));
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
  writeLocal(durableSessionKey, token ? "1" : null);
  if (token) writeLocal(pendingLogoutKey, null);
  applyAccessToken(token);
  if (changedSession || !token) {
    // This marker carries no credential. Other tabs clear stale account data
    // and recover using the HttpOnly cookie when a protected page needs it.
    writeLocal(sessionChangeKey, JSON.stringify({
      nonce: crypto.randomUUID(),
      authenticated: Boolean(token),
    }));
  }
}
window.addEventListener("storage", event => {
  if (event.key !== sessionChangeKey) return;
  try {
    const change = JSON.parse(event.newValue || "null");
    if (change?.authenticated === true) writeLocal(durableSessionKey, "1");
    if (change?.authenticated === false) writeLocal(durableSessionKey, null);
  } catch { /* Older session markers are still handled conservatively below. */ }
  authEpoch++;
  applyAccessToken(null);
  emitSessionDiagnostic("cross_tab_session_changed");
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
type Options = RequestInit & { idempotencyKey?: string; responseType?: "blob" | "file" };
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
        ...(!(options.body instanceof FormData) ? { "content-type": "application/json" } : {}),
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
    if (response.ok && options.responseType === "file")
      return await response.blob() as T;
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
  if (hasPendingLogout()) {
    await flushPendingLogout();
    throw new ApiError(401, "LOGOUT_PENDING", "You signed out on this device.");
  }
  if (!refreshPromise) {
    emitSessionDiagnostic("refresh_started");
    const epoch = authEpoch;
    const marker = sessionMarker();
    const changed = () => epoch !== authEpoch || marker !== sessionMarker();
    const refresh = async () => {
      if (changed()) throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
      const result = await send<ApiEnvelope<{ accessToken: string }>>("/api/v1/auth/refresh", { method: "POST" }, false);
      if (changed()) throw new ApiError(409, "SESSION_CHANGED", "Your account session changed. Please retry.");
      if (!result?.data?.accessToken || typeof result.data.accessToken !== "string")
        throw new ApiError(502, "INVALID_RESPONSE", "Session recovery returned an unexpected response. Please retry.");
      writeLocal(durableSessionKey, "1");
      applyAccessToken(result.data.accessToken);
      emitSessionDiagnostic("refresh_succeeded");
    };
    // Web Locks coordinates tabs on this origin; the backend's atomic rotation
    // also covers browsers without Web Locks and independent PWA processes.
    refreshPromise = (navigator.locks?.request ? navigator.locks.request("gfu-session-refresh", refresh) : refresh())
      .catch(error => {
        emitSessionDiagnostic("refresh_failed", error);
        if (!changed() && error instanceof ApiError && error.status === 401 &&
          ["REFRESH_REQUIRED", "INVALID_REFRESH_TOKEN", "SESSION_EXPIRED", "REFRESH_TOKEN_REUSE"].includes(error.code)) setAccessToken(null);
        throw error;
      }).finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}
export async function flushPendingLogout() {
  if (!hasPendingLogout()) return;
  if (!pendingLogoutPromise) {
    pendingLogoutPromise = send<void>("/api/v1/auth/logout", { method: "POST" }, false)
      .then(() => {
        writeLocal(pendingLogoutKey, null);
        emitSessionDiagnostic("logout_revocation_succeeded");
      })
      .catch(error => {
        emitSessionDiagnostic("logout_revocation_deferred", error);
        throw error;
      })
      .finally(() => { pendingLogoutPromise = null; });
  }
  await pendingLogoutPromise;
}
export function beginLogoutSession() {
  writeLocal(pendingLogoutKey, String(Date.now()));
  setAccessToken(null);
  emitSessionDiagnostic("local_logout_completed");
}
export async function logoutSession() {
  beginLogoutSession();
  await flushPendingLogout();
}
const sessionIssuingPaths = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/google",
  "/api/v1/auth/otp/verify",
  "/api/v1/auth/signup/verify",
  "/api/v1/auth/activate-account",
]);
export const apiRequest = async <T>(path: string, options: Options = {}) => {
  // Never let a delayed offline logout clear a newly-created session cookie.
  if (hasPendingLogout() && sessionIssuingPaths.has(path)) await flushPendingLogout();
  return send<T>(path, options, true);
};
export const apiDownload = (path: string) => send<Blob>(path, { responseType: "blob" }, true);
export const apiFileDownload = (path: string, options: Omit<Options, "responseType"> = {}) =>
  send<Blob>(path, { ...options, responseType: "file" }, true);
export interface ApiEnvelope<T> {
  success: true;
  message?: string;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    hasMore?: boolean;
    nextCursor?: string;
    timezone?: string;
    serverNow?: string;
    eligibleGymCount?: number;
  };
}
