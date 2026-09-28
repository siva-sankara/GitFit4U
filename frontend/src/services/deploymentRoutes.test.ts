// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
const spa = new RegExp(`^${config.rewrites[0].source}$`);
it.each(["/", "/explore", "/help", "/contact", "/login", "/register-gym", "/app/classes", "/owner/members", "/messages/thread-1", "/a-real-unknown-route"])("serves the SPA router for direct navigation: %s", path => {
  expect(spa.test(path)).toBe(true); expect(config.rewrites[0].destination).toBe("/index.html");
});
it.each(["/api", "/api/v1/auth/refresh", "/assets/missing.js", "/assets/missing", "/brand/missing.png", "/missing.js", "/app/missing.css", "/sw.js", "/manifest.webmanifest", "/.env"])("never rewrites an API or asset request to application HTML: %s", path => {
  expect(spa.test(path)).toBe(false);
});
