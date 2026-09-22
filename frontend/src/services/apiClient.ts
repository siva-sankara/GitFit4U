const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
let accessToken = sessionStorage.getItem("gfu_access_token");
let refreshPromise: Promise<void> | null = null;
export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null) {
  if (token === accessToken) return;
  const changedSession = !accessToken || !token;
  accessToken = token;
  token
    ? sessionStorage.setItem("gfu_access_token", token)
    : sessionStorage.removeItem("gfu_access_token");
  window.dispatchEvent(
    new CustomEvent("gfu-auth", { detail: { token, changedSession } }),
  );
}
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
type Options = RequestInit & { idempotencyKey?: string };
async function send<T>(
  path: string,
  options: Options,
  retry: boolean,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      signal: options.signal || controller.signal,
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
        ...options.headers,
      },
    });
    if (response.status === 401 && retry && !path.startsWith("/api/v1/auth/")) {
      await refreshSession();
      return send<T>(path, options, false);
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
      const validation = payload?.error?.details?.fieldErrors;
      const suffix = validation
        ? Object.values(validation).flat().filter(Boolean).join(" ")
        : "";
      throw new ApiError(
        response.status,
        payload?.error?.code || "REQUEST_FAILED",
        [payload?.error?.message || "Request failed.", suffix]
          .filter(Boolean)
          .join(" "),
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
      controller.signal.aborted
        ? "The request timed out. Please retry."
        : "Unable to reach the server. Check your connection and retry.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function refreshSession() {
  if (!refreshPromise)
    refreshPromise = send<ApiEnvelope<{ accessToken: string }>>(
      "/api/v1/auth/refresh",
      { method: "POST" },
      false,
    )
      .then((r) => {
        setAccessToken(r.data.accessToken);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401)
          setAccessToken(null);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  await refreshPromise;
}
export const apiRequest = <T>(path: string, options: Options = {}) =>
  send<T>(path, options, true);
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
  };
}
