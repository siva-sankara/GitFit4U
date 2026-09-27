import { Router } from "express";
import { z } from "zod";
import * as controller from "../controllers/adminController.js";
import * as management from "../controllers/adminManagementController.js";
import {
  adminCreateMember,
  adminMemberDetails,
  adminUpdateMember,
  adminDecideJoin,
} from "../controllers/memberManagementController.js";
import { MembershipPlan } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { refundPayment } from "../controllers/checkoutController.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/auth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { platformInput } from "./inputSchemas.js";
import * as promotions from "../controllers/promotionController.js";

export const adminRoutes = Router();
adminRoutes.use(
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("admin:platform"),
);
adminRoutes.get("/dashboard", controller.dashboard);
adminRoutes.get("/promotions/offers", promotions.listOffers);
adminRoutes.post("/promotions/offers", promotions.createOffer);
adminRoutes.patch("/promotions/offers/:id", promotions.updateOffer);
adminRoutes.get("/promotions/ads", promotions.listAds);
adminRoutes.post("/promotions/ads", promotions.createAd);
adminRoutes.patch("/promotions/ads/:id", promotions.updateAd);
adminRoutes.post("/users", management.createAccount);
adminRoutes.patch("/users/:id", management.updateAccount);
adminRoutes.post("/users/:id/roles", management.assignRole);
adminRoutes.patch("/gyms/:id", management.editGym);
adminRoutes.post("/membership-plans", management.savePlan);
adminRoutes.patch("/membership-plans/:id", management.savePlan);
adminRoutes.post("/memberships/:id/status", management.membershipAction);
adminRoutes.patch("/members/:id", adminUpdateMember);
adminRoutes.post("/members/:id/join/:decision", adminDecideJoin);
adminRoutes.get("/members/:id", adminMemberDetails);
adminRoutes.post(
  "/gyms/:gymId/members",
  requireIdempotencyKey,
  adminCreateMember,
);
adminRoutes.get("/gyms/:gymId/plans", async (req, res) => {
  const gym = await Gym.findOne({ publicId: req.params.gymId });
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  res.json({
    success: true,
    data: await MembershipPlan.find({
      gymId: gym._id,
      status: "ACTIVE",
    }).lean(),
  });
});
adminRoutes.patch("/trainers/:id", management.updateTrainer);
adminRoutes.post("/notifications/:id/archive", management.archiveNotification);
adminRoutes.get("/settings", management.settings);
adminRoutes.patch("/settings", management.settings);
adminRoutes.get("/registrations", controller.listRegistrations);
adminRoutes.get("/registrations/:id", controller.registrationDetails);
adminRoutes.get("/gyms", controller.listGyms);
adminRoutes.post(
  "/gyms/:id/status",
  requireIdempotencyKey,
  async (req, res) => {
    const body = z
      .object({
        action: z.enum(["activate", "suspend", "archive"]),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    req.params.action = body.action;
    req.body = { reason: body.reason };
    return controller.setGymStatus(req, res);
  },
);
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
        offlineConfirmed: z.boolean().optional(),
        offlineReference: z.string().trim().max(120).optional(),
      }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  refundPayment,
);
