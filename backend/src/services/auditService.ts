import type { Request } from "express";
import { AuditLog } from "../models/Operations.js";
import { sha256 } from "../utils/crypto.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "codeHash",
  "refreshTokenHash",
  "accessToken",
  "phone",
  "email",
  "accountNumber",
  "ifsc",
  "secret"
]);

function sanitize(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key) ? "[REDACTED]" : sanitize(item)
    ])
  );
}

export async function writeAudit(
  req: Request,
  input: {
    action: string;
    entityType: string;
    entityId?: string;
    outcome?: "SUCCESS" | "DENIED" | "FAILED";
    reason?: string;
    before?: unknown;
    after?: unknown;
  }
) {
  await AuditLog.create({
    actorId: req.auth?.userId,
    actorRole: req.auth?.role,
    gymId: req.auth?.gymId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    outcome: input.outcome || "SUCCESS",
    reason: input.reason,
    before: sanitize(input.before),
    after: sanitize(input.after),
    requestId: req.requestId,
    ipHash: req.ip ? sha256(req.ip) : undefined,
    device: req.header("user-agent")?.slice(0, 200)
  });
}
