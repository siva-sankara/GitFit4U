// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function worker() {
  const events: Record<string, (event: any) => void> = {};
  const cache = { add: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), match: vi.fn().mockResolvedValue(new Response("<h1>Offline</h1>")), keys: vi.fn().mockResolvedValue(["getfit4u-shell-v2", "getfit4u-offline-v3", "unrelated-cache"]), delete: vi.fn().mockResolvedValue(true) };
  const self = { location: { origin: "https://fitness.example" }, skipWaiting: vi.fn(), addEventListener: (type: string, callback: (event: any) => void) => { events[type] = callback; } };
  const fetch = vi.fn().mockRejectedValue(new TypeError("Offline"));
  runInNewContext(source, { self, caches, fetch, URL, Response });
  return { events, cache, caches, self, fetch };
}
it("caches only the public offline document and activates updates only after an explicit request", async () => {
  const sw = worker();
  let work: Promise<unknown> = Promise.resolve();
  sw.events.install({ waitUntil: (value: Promise<unknown>) => { work = value; } });
  await work;
  expect(sw.cache.add).toHaveBeenCalledExactlyOnceWith("/offline.html");
  expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  sw.events.message({ data: { type: "GETFIT4U_APPLY_UPDATE" } });
  expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
  sw.events.activate({ waitUntil: (value: Promise<unknown>) => { work = value; } });
  await work;
  expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith("getfit4u-shell-v2");
});
it.each(["/api/v1/users/me/messages", "/api/v1/invoices/invoice_1/pdf", "/uploads/private.jpg", "/assets/anything.png", "https://storage.example/private.pdf"])("does not intercept or cache private/API/asset fetches: %s", path => {
  const sw = worker(), respondWith = vi.fn();
  sw.events.fetch({ request: { url: new URL(path, sw.self.location.origin).href, method: "GET", mode: "cors" }, respondWith });
  expect(respondWith).not.toHaveBeenCalled();
  expect(sw.fetch).not.toHaveBeenCalled();
  expect(sw.caches.open).not.toHaveBeenCalled();
});
it("returns an honest uncached 503 offline page for failed navigation", async () => {
  const sw = worker();
  let result: Promise<Response> = Promise.resolve(new Response());
  sw.events.fetch({ request: { url: "https://fitness.example/app/classes", method: "GET", mode: "navigate" }, respondWith: (value: Promise<Response>) => { result = value; } });
  const response = await result;
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toContain("Offline");
});
