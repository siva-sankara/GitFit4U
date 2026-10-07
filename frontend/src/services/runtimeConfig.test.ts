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
