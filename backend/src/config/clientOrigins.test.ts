import { describe, expect, it } from "vitest";
import { normalizeClientOrigins } from "./clientOrigins.js";

describe("frontend origin configuration", () => {
  it("normalizes production domains while preserving the primary frontend", () => {
    expect(normalizeClientOrigins(" https://www.getfit4u.in/, https://git-fit4-u.vercel.app/ ,https://www.getfit4u.in "))
      .toBe("https://www.getfit4u.in,https://git-fit4-u.vercel.app");
  });

  it("retains localhost ports for development", () => {
    expect(normalizeClientOrigins("http://localhost:5173/")).toBe("http://localhost:5173");
  });

  it.each([
    "", " , ", "*", "https://*.vercel.app", "www.getfit4u.in",
    "https://www.getfit4u.in/login", "https://user:password@getfit4u.in",
    "https://www.getfit4u.in/?key=value", "https://www.getfit4u.in/#fragment", "file:///frontend",
  ])("rejects invalid origin configuration: %s", (value) => {
    expect(() => normalizeClientOrigins(value)).toThrow(/CLIENT_ORIGIN/);
  });
});
