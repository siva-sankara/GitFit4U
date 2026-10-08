// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
let api: typeof import("./apiClient");
const fetcher = vi.fn();
const ok = (data: unknown = {}) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (status = 401, code = "SESSION_EXPIRED") => new Response(JSON.stringify({ error: { code, message: "test error" } }), { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.resetModules(); sessionStorage.clear(); localStorage.clear(); fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  api = await import("./apiClient"); api.setAccessToken("old-access");
});
afterEach(() => vi.unstubAllGlobals());

it("does not resurrect an explicitly signed-out session when pending refresh completes", async () => {
  const pending = deferred<Response>(); fetcher.mockReturnValue(pending.promise);
  const refresh = api.refreshSession().catch(() => undefined);
  await Promise.resolve(); api.setAccessToken(null);
  pending.resolve(ok({ accessToken: "new-access" })); await refresh;
  expect(api.getAccessToken()).toBeNull();
});

it("shares one refresh among simultaneous protected requests", async () => {
  fetcher.mockImplementation(async (url: string, options: RequestInit) => url.endsWith("/auth/refresh")
    ? ok({ accessToken: "new-access" })
    : (options.headers as Record<string,string>).authorization === "Bearer old-access" ? fail() : ok({ value: true }));
  await Promise.all([api.apiRequest("/api/v1/one"), api.apiRequest("/api/v1/two")]);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
});

it("background access-token recovery does not claim foreground activity", async () => {
  fetcher.mockResolvedValue(ok({ accessToken: "new-access" }));
  await api.refreshSession();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ activity: false });
});

it("does not lose foreground renewal when a background refresh is already in flight", async () => {
  const pending = deferred<Response>();
  fetcher.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok({ accessToken: "active-access" }));
  const background = api.refreshSession();
  const visit = api.refreshSession({ activity: true });
  pending.resolve(ok({ accessToken: "background-access" }));
  await Promise.all([background, visit]);
  expect(fetcher.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([{ activity: false }, { activity: true }]);
  expect(api.getAccessToken()).toBe("active-access");
});

it("restores access from the HttpOnly cookie after reopening with empty sessionStorage", async () => {
  sessionStorage.clear();
  vi.resetModules();
  const reopened = await import("./apiClient");
  expect(reopened.getAccessToken()).toBeNull();
  expect(reopened.hasPersistedSession()).toBe(true);
  fetcher.mockResolvedValue(ok({ accessToken: "recovered-access" }));
  await reopened.refreshSession({ activity: true });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "include", body: '{"activity":true}' });
  expect(reopened.getAccessToken()).toBe("recovered-access");
  expect(sessionStorage.getItem("gfu_access_token")).toBeNull();
  expect(localStorage.getItem("gfu_access_token")).toBeNull();
});

it("uses an already refreshed access token for a delayed401 without rotating again", async () => {
  const late = deferred<Response>();
  fetcher.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.endsWith("/auth/refresh")) return ok({ accessToken: "new-access" });
    if ((options.headers as Record<string,string>).authorization !== "Bearer old-access") return ok();
    return url.endsWith("/late") ? late.promise : fail();
  });
  const delayed = api.apiRequest("/api/v1/late");
  await api.apiRequest("/api/v1/fast"); late.resolve(fail()); await delayed;
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1);
});

it.each([[400,"INVALID_BODY"], [403,"PERMISSION_DENIED"], [413,"UPLOAD_TOO_LARGE"], [500,"INTERNAL_ERROR"], [401,"PROVIDER_ERROR"]])("preserves auth after a %s %s failure", async (status, code) => {
  fetcher.mockResolvedValue(fail(Number(status), String(code)));
  await expect(api.apiRequest("/api/v1/action")).rejects.toMatchObject({ status, code });
  expect(api.getAccessToken()).toBe("old-access"); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps credentials and recovery available after refresh network failure", async () => {
  fetcher.mockRejectedValue(new TypeError("offline"));
  await expect(api.refreshSession()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(api.getAccessToken()).toBe("old-access");
  fetcher.mockResolvedValue(ok({ accessToken: "new-access" }));
  await api.refreshSession(); expect(api.getAccessToken()).toBe("new-access");
});

it("clears auth only for a real rejected refresh", async () => {
  fetcher.mockResolvedValue(fail(401,"REFRESH_TOKEN_REUSE"));
  await expect(api.refreshSession()).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSE" });
  expect(api.getAccessToken()).toBeNull();
});

it("does not blindly replay mutations without an idempotency key", async () => {
  fetcher.mockImplementation(async (url: string) => url.endsWith("/auth/refresh") ? ok({ accessToken: "new-access" }) : fail());
  await expect(api.apiRequest("/api/v1/action", { method:"POST", body:"{}" })).rejects.toMatchObject({ code:"AUTH_RETRY_REQUIRED" });
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/action"))).toHaveLength(1);
  expect(api.getAccessToken()).toBe("new-access");
});

it("replays an idempotent mutation once with its original key and body", async () => {
  fetcher.mockImplementation(async (url: string, options: RequestInit) => url.endsWith("/auth/refresh") ? ok({ accessToken: "new-access" }) :
    (options.headers as Record<string,string>).authorization === "Bearer old-access" ? fail() : ok());
  await api.apiRequest("/api/v1/action", { method:"POST", body:'{"value":1}', idempotencyKey:"same-attempt" });
  const actions = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/action"));
  expect(actions).toHaveLength(2);
  for (const [, options] of actions) {
    expect(options.body).toBe('{"value":1}'); expect(options.headers["idempotency-key"]).toBe("same-attempt");
  }
});

it("serializes refresh through Web Locks when available", async () => {
  const request = vi.fn(async (_name, work) => work());
  Object.defineProperty(navigator, "locks", { configurable:true, value:{ request } });
  fetcher.mockResolvedValue(ok({ accessToken:"new-access" }));
  await api.refreshSession(); expect(request).toHaveBeenCalledWith("gfu-session-refresh", expect.any(Function));
  Object.defineProperty(navigator, "locks", { configurable:true, value:undefined });
});

it("clears a stale tab from a nonsecret session-change event", () => {
  window.dispatchEvent(new StorageEvent("storage", { key:"gfu-session-change", newValue:"event-nonce" }));
  expect(api.getAccessToken()).toBeNull();
  expect(sessionStorage.getItem("gfu_access_token")).toBeNull();
});

it("does not accept an old refresh response after another tab changes the shared cookie session", async () => {
  const pending = deferred<Response>(); fetcher.mockReturnValue(pending.promise);
  const result = api.refreshSession();
  localStorage.setItem("gfu-session-change", "another-tab-signed-out");
  pending.resolve(ok({ accessToken:"stale-access" }));
  await expect(result).rejects.toMatchObject({ code:"SESSION_CHANGED" });
  expect(api.getAccessToken()).not.toBe("stale-access");
});

it("preserves auth when a refresh response is malformed", async () => {
  fetcher.mockResolvedValue(ok({}));
  await expect(api.refreshSession()).rejects.toMatchObject({ code:"INVALID_RESPONSE" });
  expect(api.getAccessToken()).toBe("old-access");
});

it("honors external cancellation without clearing auth or replaying the request", async () => {
  const controller = new AbortController();
  fetcher.mockImplementation((_url, options:RequestInit) => new Promise((_resolve,reject) => {
    options.signal!.addEventListener("abort", () => reject(new DOMException("cancelled","AbortError")),{ once:true });
  }));
  const pending = api.apiRequest("/api/v1/action",{ method:"POST", signal:controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code:"NETWORK_ERROR", message:expect.stringContaining("cancelled") });
  expect(api.getAccessToken()).toBe("old-access"); expect(fetcher).toHaveBeenCalledOnce();
});

it("keeps a non-secret recovery hint while authenticated and removes it on definitive sign-out", () => {
  expect(api.hasPersistedSession()).toBe(true);
  expect(localStorage.getItem("gfu-has-session")).toBe("1");
  api.setAccessToken(null);
  expect(api.hasPersistedSession()).toBe(false);
  expect(localStorage.getItem("gfu-has-session")).toBeNull();
});

it("stays locally signed out after an offline logout and retries cookie revocation later", async () => {
  fetcher.mockRejectedValueOnce(new TypeError("offline"));
  await expect(api.logoutSession()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(api.getAccessToken()).toBeNull();
  expect(api.hasPersistedSession()).toBe(false);
  expect(api.hasPendingLogout()).toBe(true);
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await api.flushPendingLogout();
  expect(api.hasPendingLogout()).toBe(false);
});

it("blocks cookie recovery while an explicit logout is pending", async () => {
  fetcher.mockRejectedValueOnce(new TypeError("offline"));
  await expect(api.logoutSession()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(api.refreshSession()).rejects.toMatchObject({ code: "LOGOUT_PENDING" });
  expect(api.getAccessToken()).toBeNull();
  expect(api.hasPendingLogout()).toBe(false);
});

it("emits structured session diagnostics without credentials", async () => {
  const events: unknown[] = [];
  const observe = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener("gfu-session-diagnostic", observe);
  fetcher.mockResolvedValue(ok({ accessToken: "new-access" }));
  await api.refreshSession();
  window.removeEventListener("gfu-session-diagnostic", observe);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: "refresh_started", online: expect.any(Boolean) }),
    expect.objectContaining({ event: "refresh_succeeded" }),
  ]));
  expect(JSON.stringify(events)).not.toContain("old-access");
  expect(JSON.stringify(events)).not.toContain("new-access");
});

const token = (sid = "session", version = 1) => `header.${btoa(JSON.stringify({ sub: "user", sid, iat: version }))}.signature`;

it("does not invalidate the first profile request when the login page confirms the already established token", async () => {
  const profile = deferred<Response>();
  api.setAccessToken(token());
  fetcher.mockReturnValueOnce(profile.promise);
  const request = api.apiRequest("/api/v1/auth/me");
  // The API handshake publishes authentication before AuthDesktopPage.finish.
  api.setAccessToken(token());
  profile.resolve(ok({ user: { name: "Member" } }));
  await expect(request).resolves.toMatchObject({ data: { user: { name: "Member" } } });
});

it("migrates an old tab token to cookie recovery without retaining the credential in storage", async () => {
  sessionStorage.setItem("gfu_access_token", "legacy-token");
  localStorage.removeItem("gfu-has-session");
  vi.resetModules();
  const reopened = await import("./apiClient");
  expect(reopened.getAccessToken()).toBeNull();
  expect(reopened.hasPersistedSession()).toBe(true);
  expect(sessionStorage.getItem("gfu_access_token")).toBeNull();
});

it("finishes login only after a cookie round trip and keeps access credentials out of browser storage", async () => {
  fetcher.mockResolvedValueOnce(ok({ accessToken: token(), user: { name: "Member" } }))
    .mockResolvedValueOnce(ok({ accessToken: token("session", 2) }));
  const result = await api.apiRequest<any>("/api/v1/auth/login", { method: "POST", body: "{}" });
  expect(result.data.accessToken).toBe(token("session", 2));
  expect(result.data.user.name).toBe("Member");
  expect(api.getAccessToken()).toBe(result.data.accessToken);
  expect(fetcher.mock.calls[1][0]).toBe("/api/v1/auth/refresh");
  expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: "include", body: '{"activity":true}' });
  expect(sessionStorage.getItem("gfu_access_token")).toBeNull();
  expect(localStorage.getItem("gfu_access_token")).toBeNull();
});

it.each(["REFRESH_REQUIRED", "SESSION_EXPIRED"])("reports a failed cookie check (%s) at sign-in instead of logging out a minute later", async code => {
  fetcher.mockResolvedValueOnce(ok({ accessToken: token() })).mockResolvedValueOnce(fail(401, code));
  await expect(api.apiRequest("/api/v1/auth/login", { method: "POST" }))
    .rejects.toMatchObject({ code: "SESSION_COOKIE_UNAVAILABLE", status: 503 });
  expect(api.getAccessToken()).toBeNull();
});

it("rejects a stale cookie that restores a different session during login", async () => {
  fetcher.mockResolvedValueOnce(ok({ accessToken: token() }))
    .mockResolvedValueOnce(ok({ accessToken: token("another-session") }));
  await expect(api.apiRequest("/api/v1/auth/google", { method: "POST" }))
    .rejects.toMatchObject({ code: "SESSION_COOKIE_UNAVAILABLE" });
  expect(api.getAccessToken()).toBeNull();
});

it("does not race an activity refresh against login", async () => {
  const pending = deferred<Response>();
  fetcher.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok({ accessToken: token() }));
  const login = api.apiRequest("/api/v1/auth/login", { method: "POST" });
  const activity = api.refreshSession({ activity: true });
  pending.resolve(ok({ accessToken: token() }));
  await Promise.all([login, activity]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(api.getAccessToken()).toBe(token());
});

it("revokes cookies after a login response when explicit logout wins the race", async () => {
  const pending = deferred<Response>();
  fetcher.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new Response(null, { status: 204 }));
  const login = api.apiRequest("/api/v1/auth/login", { method: "POST" }).catch(() => undefined);
  const logout = api.logoutSession();
  pending.resolve(ok({ accessToken: token() }));
  await Promise.all([login, logout]);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/v1/auth/login", "/api/v1/auth/logout"]);
  expect(api.getAccessToken()).toBeNull();
});

it("silently renews expired access for protected auth endpoints too", async () => {
  fetcher.mockImplementation(async (url: string, options: RequestInit) => url.endsWith("/auth/refresh")
    ? ok({ accessToken: "new-access" })
    : (options.headers as Record<string, string>).authorization === "Bearer old-access" ? fail() : ok({ user: "member" }));
  await expect(api.apiRequest("/api/v1/auth/me")).resolves.toMatchObject({ data: { user: "member" } });
  expect(api.getAccessToken()).toBe("new-access");
});
