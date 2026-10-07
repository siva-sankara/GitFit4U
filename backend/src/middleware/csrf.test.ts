import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/db.js", () => ({ connectDatabase: vi.fn().mockResolvedValue(undefined) }));
import { env } from "../config/env.js";
import { requireCsrfProtection } from "./csrf.js";
import { errorHandler } from "./errorHandler.js";
import { app } from "../app.js";

function fixture() {
  const server = express();
  let mutations = 0;
  server.use(requireCsrfProtection);
  server.all("/session", (_req, res) => { mutations++; res.sendStatus(204); });
  server.use(errorHandler);
  return { server, count: () => mutations };
}
describe("cookie authentication CSRF boundary", () => {
  it.each(["https://untrusted.example", "null"])("rejects an untrusted origin even with the header: %s", async origin => {
    const test = fixture();
    const res = await request(test.server).post("/session").set("Origin", origin).set("x-csrf-protection", "1");
    expect(res.status).toBe(403);
    expect(test.count()).toBe(0);
  });
  it.each(["application/x-www-form-urlencoded", "text/plain", "application/json"])("rejects requests without the preflight header: %s", async contentType => {
    const test = fixture();
    const res = await request(test.server).post("/session").set("Content-Type", contentType).set("Cookie", "gfu_refresh=synthetic.session");
    expect(res.status).toBe(403);
    expect(test.count()).toBe(0);
  });
  it("allows a configured browser origin with the header", async () => {
    const test = fixture();
    await request(test.server).post("/session").set("Origin", env.CLIENT_ORIGIN.split(",")[0].trim()).set("x-csrf-protection", "1").expect(204);
    expect(test.count()).toBe(1);
  });
  it("allows explicit nonbrowser clients and safe reads", async () => {
    const test = fixture();
    await request(test.server).post("/session").set("x-csrf-protection", "1").expect(204);
    await request(test.server).get("/session").expect(204);
  });
  it("rejects an untrusted logout origin before session revocation", async () => {
    const res = await request(app).post("/api/v1/auth/logout").set("Origin", "https://untrusted.example").set("Sec-Fetch-Site", "cross-site").set("Cookie", "gfu_refresh=synthetic.session").type("form").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CORS_ORIGIN_REJECTED");
  });
  it("keeps valid logout without a cookie idempotent", async () => {
    await request(app).post("/api/v1/auth/logout").set("x-csrf-protection", "1").expect(204);
  });
});
