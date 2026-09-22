import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "./validate.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.post("/register", validate(z.object({
    body: z.object({ name: z.string().trim().min(2), email: z.string().email(), password: z.string().min(10) }),
    params: z.object({}),
    query: z.object({})
  })), (req, res) => res.status(201).json({ name: req.body.name, query: req.query }));
  app.get("/items/:id", validate(z.object({
    params: z.object({ id: z.coerce.number().int() }),
    query: z.object({ page: z.coerce.number().int().positive().default(1) })
  })), (req, res) => res.json({ params: req.params, query: req.query }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.statusCode ?? 500).json({ code: error.code ?? "INTERNAL_ERROR" });
  };
  app.use(errors);
  return app;
}

describe("request validation with Express 5", () => {
  it("accepts a signup body and empty query without throwing", async () => {
    const response = await request(createApp()).post("/register").send({
      name: " Member ", email: "member@example.com", password: "StrongPass123"
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ name: "Member", query: {} });
  });

  it("preserves parsed parameters, query coercion, defaults and unknown-key removal", async () => {
    const app = createApp();
    const supplied = await request(app).get("/items/42?page=2&extra=ignored");
    expect(supplied.status).toBe(200);
    expect(supplied.body).toEqual({ params: { id: 42 }, query: { page: 2 } });
    const defaults = await request(app).get("/items/42");
    expect(defaults.status).toBe(200);
    expect(defaults.body.query).toEqual({ page: 1 });
  });

  it("rejects invalid input before reaching the handler", async () => {
    const response = await request(createApp()).post("/register").send({ name: "A" });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
