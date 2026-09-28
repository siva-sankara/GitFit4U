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
