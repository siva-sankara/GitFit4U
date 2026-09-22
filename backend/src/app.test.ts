import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("GET /health", () => {
  it("returns an operational health response without exposing framework details", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("getfit4u-api");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
