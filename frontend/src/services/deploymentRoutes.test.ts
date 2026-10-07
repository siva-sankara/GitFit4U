// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
const api = config.rewrites.find((rewrite: { source: string }) => rewrite.source === "/api/v1/:path*");
const spaRewrite = config.rewrites.find((rewrite: { destination: string }) => rewrite.destination === "/index.html");
const spa = new RegExp(`^${spaRewrite.source}$`);
it("proxies browser API traffic through the frontend origin so refresh cookies remain first-party", () => {
  expect(api).toEqual({
    source: "/api/v1/:path*",
    destination: "https://git-fit4-u-un7d.vercel.app/api/v1/:path*",
  });
});
it.each(["/", "/explore", "/help", "/contact", "/terms-and-policies", "/terms-and-conditions", "/privacy-policy", "/refund-cancellation-policy", "/data-deletion", "/login", "/register-gym", "/app/classes", "/owner/members", "/messages/thread-1", "/a-real-unknown-route"])("serves the SPA router for direct navigation: %s", path => {
  expect(spa.test(path)).toBe(true); expect(spaRewrite.destination).toBe("/index.html");
});
it.each(["/api", "/api/v1/auth/refresh", "/assets/missing.js", "/assets/missing", "/brand/missing.png", "/missing.js", "/app/missing.css", "/sw.js", "/manifest.webmanifest", "/.env"])("never rewrites an API or asset request to application HTML: %s", path => {
  expect(spa.test(path)).toBe(false);
});
