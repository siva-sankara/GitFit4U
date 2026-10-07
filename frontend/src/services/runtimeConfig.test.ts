import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("always uses the frontend origin during development, even with an old direct API URL", async () => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_API_URL", "http://localhost:5001");
  expect((await import("./runtimeConfig")).API_URL).toBe("");
});

it("preserves explicit production API configuration", async () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_API_URL", "https://api.example.test/");
  expect((await import("./runtimeConfig")).API_URL).toBe("https://api.example.test");
});

it.each(["VITE_API_URL", "VITE_API_BASE_URL"])("uses the same-origin proxy when production still has a legacy %s", async key => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_API_URL", "");
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.stubEnv(key, " https://git-fit4-u-un7d.vercel.app/ ");
  expect((await import("./runtimeConfig")).API_URL).toBe("");
});

it("uses the same-origin production proxy when no API URL is configured", async () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_API_URL", "");
  vi.stubEnv("VITE_API_BASE_URL", "");
  expect((await import("./runtimeConfig")).API_URL).toBe("");
});
