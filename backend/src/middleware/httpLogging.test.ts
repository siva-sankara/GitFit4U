import { expect, it } from "vitest";
import { requestSummary } from "./httpLogging.js";
import { safeError } from "../config/logger.js";
it("keeps request metadata concise and omits query credentials, headers and bodies", () => {
  const output = requestSummary({
    method: "POST",
    originalUrl: "/api/v1/users/me?token=secret&email=private",
    requestId: "request-id",
    headers: { authorization: "Bearer secret" },
    body: { password: "secret" },
  } as any);
  expect(output).toEqual({
    id: "request-id",
    method: "POST",
    path: "/api/v1/users/me",
  });
  expect(JSON.stringify(output)).not.toContain("secret");
});
it("does not serialize raw provider errors, secrets or stack traces", () => {
  const error = Object.assign(new Error("token=private db-password=private"), {
    code: "AccessDenied",
    authorization: "private",
  });
  expect(safeError(error)).toEqual({ type: "Error", code: "AccessDenied" });
  expect(
    safeError({ name: "bad private text", code: "private/token" }),
  ).toEqual({ type: "Error", code: undefined });
});
