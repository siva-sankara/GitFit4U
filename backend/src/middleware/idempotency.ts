import type { RequestHandler } from "express";
import { AppError } from "../utils/AppError.js";

export const requireIdempotencyKey: RequestHandler = (req, _res, next) => {
  const key = req.header("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    return next(
      new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required for this action.")
    );
  }
  req.idempotencyKey = key;
  next();
};
