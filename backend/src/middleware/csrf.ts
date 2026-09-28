import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

// A non-safelisted header forces cross-origin browsers through CORS preflight.
// It is not a secret or authentication credential. Origin is checked separately
// because CORS response headers alone do not prevent a request from executing.
export const requireCsrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = env.CLIENT_ORIGIN.split(",").map((value) => value.trim());
  if ((origin && !allowed.includes(origin)) || req.get("x-csrf-protection") !== "1") {
    return next(new AppError(403, "CSRF_REJECTED", "This authentication request could not be verified. Reload the application and try again."));
  }
  next();
};
