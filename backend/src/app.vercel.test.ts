import type { Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  route: vi.fn(),
  webhook: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./config/env.js", () => ({
  env: { NODE_ENV: "test", CLIENT_ORIGIN: "https://www.getfit4u.in,https://git-fit4-u.vercel.app" },
}));
vi.mock("./config/db.js", () => ({ connectDatabase: mocks.connect }));
vi.mock("./config/logger.js", () => ({ logger: { error: mocks.logError } }));
vi.mock("./middleware/httpLogging.js", () => ({
  httpLogging: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./docs/openapi.js", () => ({ openapi: {} }));
vi.mock("./controllers/checkoutController.js", () => ({
  razorpayWebhook: mocks.webhook,
}));
vi.mock("./routes/index.js", async () => {
  const { Router } = await import("express");
  const apiRoutes = Router();
  apiRoutes.get("/probe", (_req, res) => {
    mocks.route();
    res.json({ ok: true });
  });
  return { apiRoutes };
});

import app, { app as namedApp } from "./app.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.webhook.mockImplementation((req: Request, res: Response) => {
    res.json({ raw: Buffer.isBuffer(req.body), body: req.body.toString("utf8") });
  });
});

describe("Vercel Express entry point", () => {
  it.each(["https://www.getfit4u.in", "https://git-fit4-u.vercel.app"])("allows credentialed preflight from %s before connecting to MongoDB", async (origin) => {
    const response = await request(app).options("/api/v1/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization,x-csrf-protection,idempotency-key");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-headers"]).toContain("x-csrf-protection");
    expect(response.headers.vary).toContain("Origin");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(["https://untrusted.example", "https://www.getfit4u.in.untrusted.example", "null"])("does not grant CORS access to %s", async (origin) => {
    const response = await request(app).options("/api/v1/auth/login")
      .set("Origin", origin).set("Access-Control-Request-Method", "POST");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("exports a callable default handler and serves health without MongoDB", async () => {
    expect(typeof app).toBe("function");
    expect(app).toBe(namedApp);
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", service: "getfit4u-api" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("returns the API's normal 404 for the root and favicon", async () => {
    for (const path of ["/", "/favicon.ico"]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    }
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("waits for the database before running API handlers", async () => {
    let connected!: () => void;
    mocks.connect.mockReturnValue(new Promise<void>((resolve) => { connected = resolve; }));
    const pending = request(app).get("/api/v1/probe").then((response) => response);
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.route).not.toHaveBeenCalled();
    connected();
    expect((await pending).status).toBe(200);
    expect(mocks.route).toHaveBeenCalledOnce();
  });

  it("connects for webhooks and preserves the exact signed request bytes", async () => {
    const body = '{ "event": "payment.captured" }';
    const response = await request(app).post("/api/v1/webhooks/razorpay")
      .set("Content-Type", "application/json").send(body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ raw: true, body });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(mocks.webhook.mock.invocationCallOrder[0]);
  });

  it("passes database failures to the existing error handler and allows a retry", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Database unavailable"));
    const failed = await request(app).get("/api/v1/probe");
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe("INTERNAL_ERROR");
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledOnce();
    const retried = await request(app).get("/api/v1/probe");
    expect(retried.status).toBe(200);
    expect(mocks.route).toHaveBeenCalledOnce();
  });
});
