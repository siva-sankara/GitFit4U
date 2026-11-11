import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  beginGymRazorpayConnection,
  completeGymRazorpayConnection,
  disconnectGymRazorpay,
  gymRazorpayStatus,
} from "../controllers/razorpayOAuthController.js";
import { requireAuth, requireGymContext, requirePermission, requireRole } from "../middleware/auth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";

export const razorpayConnectionRoutes = Router();

razorpayConnectionRoutes.get(
  "/payments/razorpay/oauth/callback",
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  completeGymRazorpayConnection,
);

const gymParams = z.object({ gymId: z.string().min(8).max(64) });
razorpayConnectionRoutes.post(
  "/gyms/:gymId/payments/razorpay/connect",
  requireAuth,
  requireRole("GYM_OWNER"),
  requireGymContext,
  requirePermission("gym:update"),
  requireIdempotencyKey,
  validate(z.object({
    body: z.object({ returnTo: z.string().max(500).optional() }).strict(),
    params: gymParams,
    query: z.object({}),
  })),
  beginGymRazorpayConnection,
);
razorpayConnectionRoutes.get(
  "/gyms/:gymId/payments/razorpay/status",
  requireAuth,
  requireRole("GYM_OWNER"),
  requireGymContext,
  requirePermission("gym:read"),
  validate(z.object({ body: z.any().optional(), params: gymParams, query: z.object({}) })),
  gymRazorpayStatus,
);
razorpayConnectionRoutes.post(
  "/gyms/:gymId/payments/razorpay/disconnect",
  requireAuth,
  requireRole("GYM_OWNER"),
  requireGymContext,
  requirePermission("gym:update"),
  requireIdempotencyKey,
  validate(z.object({ body: z.object({}).strict(), params: gymParams, query: z.object({}) })),
  disconnectGymRazorpay,
);

