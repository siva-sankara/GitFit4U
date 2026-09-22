import { Router } from "express";
import { z } from "zod";
import * as controller from "../controllers/adminController.js";
import { refundPayment } from "../controllers/checkoutController.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/auth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { platformInput } from "./inputSchemas.js";

export const adminRoutes = Router();
adminRoutes.use(
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("admin:platform"),
);
adminRoutes.get("/dashboard", controller.dashboard);
adminRoutes.get("/registrations", controller.listRegistrations);
adminRoutes.get("/registrations/:id", controller.registrationDetails);
adminRoutes.get("/gyms", controller.listGyms);
adminRoutes.post(
  "/gyms/:id/:action",
  requireIdempotencyKey,
  controller.setGymStatus,
);
adminRoutes.get("/platform-plans", controller.platformPlans);
adminRoutes.post(
  "/platform-plans",
  (req, _res, next) => {
    req.body = platformInput.parse(req.body);
    next();
  },
  controller.createPlatformPlan,
);
adminRoutes.get("/audit-logs", controller.auditLogs);
adminRoutes.get("/monitoring/health", controller.healthOverview);
adminRoutes.post(
  "/payments/:id/refunds",
  requireIdempotencyKey,
  validate(
    z.object({
      body: z.object({
        amountMinor: z.number().int().positive(),
        reason: z.string().min(5).max(1000),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  refundPayment,
);
