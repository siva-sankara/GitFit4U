import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { createServer, type UserConfigFnObject } from "vite";
import viteConfig from "../vite.config";

afterEach(() => vi.unstubAllEnvs());

it("forwards login cookies, refresh cookies and CSRF headers through the actual local Vite proxy", async () => {
  const received: { url?: string; cookie?: string; origin?: string; csrf?: string | string[] }[] = [];
  const backend = createHttpServer((req, res) => {
    received.push({ url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, csrf: req.headers["x-csrf-protection"] });
    res.setHeader("content-type", "application/json");
    res.setHeader("set-cookie", "gfu_refresh=isolated-test-cookie; Path=/; HttpOnly; SameSite=Lax; Max-Age=259200");
    res.end(JSON.stringify({ success: true }));
  });
  await new Promise<void>(resolve => { backend.listen(0, "127.0.0.1", resolve); });
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  vi.stubEnv("VITE_DEV_API_TARGET", target);
  const config = (viteConfig as UserConfigFnObject)({ mode: "test", command: "serve" });
  expect(config.server?.proxy?.["/api"]).toMatchObject({ target });
  expect(config.server?.proxy?.["/socket.io"]).toMatchObject({ target, ws: true });
  const frontend = await createServer({ ...config, plugins: [], configFile: false, envFile: false, logLevel: "silent",
    server: { ...config.server, host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
  });
  try {
    await frontend.listen();
    const origin = `http://127.0.0.1:${(frontend.httpServer!.address() as AddressInfo).port}`;
    const login = await fetch(`${origin}/api/v1/auth/login`, { method: "POST", headers: { origin, "x-csrf-protection": "1" } });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const refreshed = await fetch(`${origin}/api/v1/auth/refresh`, { method: "POST", headers: { cookie, origin, "x-csrf-protection": "1" } });
    expect(refreshed.status).toBe(200);
    expect(received).toEqual([
      { url: "/api/v1/auth/login", cookie: undefined, origin, csrf: "1" },
      { url: "/api/v1/auth/refresh", cookie, origin, csrf: "1" },
    ]);
  } finally {
    await frontend.close();
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) => { backend.close(error => error ? reject(error) : resolve()); });
  }
});
