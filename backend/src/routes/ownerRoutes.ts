import { Router } from "express";
import { z } from "zod";
import * as controller from "../controllers/ownerController.js";
import * as members from "../controllers/memberManagementController.js";
import * as attendance from "../controllers/attendanceController.js";
import {
  ownerMemberCreateInput,
  ownerMemberUpdateInput,
  ownerTrainerInput,
} from "./memberManagementSchemas.js";
import {
  requireAuth,
  requireGymContext,
  requirePermission,
  requireRole,
} from "../middleware/auth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import {
  gymInput,
  planInput,
  memberInput,
  classInput,
  trainerInput,
  campaignInput,
  offerInput,
  adInput,
} from "./inputSchemas.js";
import {
  registrationAddress,
  registrationContact,
  coordinatesInput,
} from "../services/registrationService.js";

export const ownerRoutes = Router();
ownerRoutes.use(requireAuth);
ownerRoutes.use((req, _res, next) => {
  const schemas: Record<string, any> = {
    "/gym": gymInput.partial(),
    "/members":
      req.method === "PATCH" ? ownerMemberUpdateInput : ownerMemberCreateInput,
    "/plans": planInput,
    "/classes": classInput,
    "/trainers":
      req.method === "PATCH" ? ownerTrainerInput.partial() : ownerTrainerInput,
    "/campaigns": campaignInput,
    "/offers": offerInput,
    "/ads": adInput,
  };
  const base = "/" + req.path.split("/")[1];
  if (
    ["POST", "PATCH"].includes(req.method) &&
    schemas[base] &&
    !(base === "/members" && req.path.includes("/join/"))
  ) {
    const schema =
      req.method === "PATCH" && base === "/plans"
        ? planInput.partial()
        : schemas[base];
    req.body = schema.parse(req.body);
  }
  if (req.method === "PATCH" && base === "/registrations")
    req.body = z
      .object({
        gym: gymInput.partial().optional(),
        currentStep: z.enum(["GYM", "PLAN"]).optional(),
      })
      .parse(req.body);
  next();
});

ownerRoutes.post(
  "/registrations",
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(4000).optional(),
        coordinates: coordinatesInput,
        timezone: gymInput.shape.timezone,
        contact: registrationContact.partial().optional(),
        address: registrationAddress.partial().optional(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createRegistration,
);
ownerRoutes.get("/registrations/:id", controller.getRegistration);
ownerRoutes.patch("/registrations/:id", controller.updateRegistration);
ownerRoutes.post(
  "/registrations/:id/submit",
  requireIdempotencyKey,
  controller.submitRegistration,
);

ownerRoutes.use(requireRole("GYM_OWNER", "GYM_STAFF"), requireGymContext);
ownerRoutes.get(
  "/dashboard",
  requirePermission("gym:read"),
  controller.dashboard,
);
ownerRoutes.get("/gym", requirePermission("gym:read"), controller.getGym);
ownerRoutes.patch(
  "/gym",
  requirePermission("gym:update"),
  controller.updateGym,
);
ownerRoutes.get(
  "/members",
  requirePermission("member:read"),
  controller.listMembers,
);
ownerRoutes.post(
  "/members",
  requirePermission("member:write"),
  controller.createMember,
);
ownerRoutes.get(
  "/members/:id",
  requirePermission("member:read"),
  controller.getMember,
);
ownerRoutes.patch(
  "/members/:id",
  requirePermission("member:write"),
  members.updateMember,
);
ownerRoutes.post(
  "/members/:id/join/:decision",
  requirePermission("member:write"),
  members.decideGymJoin,
);
ownerRoutes.get(
  "/attendance/qr",
  requirePermission("gym:read"),
  attendance.getGymQr,
);
ownerRoutes.post(
  "/attendance/qr/rotate",
  requirePermission("gym:update"),
  attendance.rotateGymQr,
);
ownerRoutes.get("/plans", requirePermission("gym:read"), controller.listPlans);
ownerRoutes.post(
  "/plans",
  requirePermission("plan:write"),
  controller.createPlan,
);
ownerRoutes.patch(
  "/plans/:id",
  requirePermission("plan:write"),
  controller.updatePlan,
);
ownerRoutes.post(
  "/scanner/check-in",
  requirePermission("attendance:scan"),
  requireIdempotencyKey,
  validate(
    z.object({
      body: z
        .object({
          memberIdentifier: z.string().min(3).optional(),
          qrToken: z.string().min(20).optional(),
          source: z.enum(["QR", "MANUAL"]).default("QR"),
          scannerId: z.string().optional(),
          qrNonce: z.string().optional(),
          location: z
            .object({
              coordinates: z.tuple([
                z.number().min(-180).max(180),
                z.number().min(-90).max(90),
              ]),
              accuracyMeters: z.number().positive().max(5000),
              capturedAt: z.coerce.date().optional(),
            })
            .optional(),
        })
        .refine(
          (value) => value.memberIdentifier || value.qrToken,
          "Member identifier or QR token is required",
        ),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.scanMember,
);
ownerRoutes.get(
  "/classes",
  requirePermission("gym:read"),
  controller.listClasses,
);
ownerRoutes.post(
  "/classes",
  requirePermission("class:write"),
  controller.createClass,
);
ownerRoutes.get(
  "/trainers",
  requirePermission("gym:read"),
  controller.listTrainers,
);
ownerRoutes.post(
  "/trainers",
  requirePermission("class:write"),
  controller.createTrainer,
);
ownerRoutes.patch(
  "/trainers/:id",
  requirePermission("class:write"),
  members.saveTrainer,
);
ownerRoutes.get(
  "/campaigns",
  requirePermission("campaign:write"),
  controller.listCampaigns,
);
ownerRoutes.post(
  "/campaigns",
  requirePermission("campaign:write"),
  controller.createCampaign,
);
ownerRoutes.get(
  "/subscriptions",
  requirePermission("member:read"),
  controller.listSubscriptions,
);
ownerRoutes.post(
  "/subscriptions/:id/:action",
  requirePermission("member:write"),
  requireIdempotencyKey,
  controller.subscriptionAction,
);
ownerRoutes.get(
  "/offers",
  requirePermission("campaign:write"),
  controller.listOffers,
);
ownerRoutes.post(
  "/offers",
  requirePermission("campaign:write"),
  controller.createOffer,
);
ownerRoutes.patch(
  "/offers/:id",
  requirePermission("campaign:write"),
  controller.updateOffer,
);
ownerRoutes.get(
  "/ads",
  requirePermission("campaign:write"),
  controller.listAds,
);
ownerRoutes.post(
  "/ads",
  requirePermission("campaign:write"),
  controller.createAd,
);
ownerRoutes.get(
  "/revenue",
  requirePermission("finance:read"),
  controller.revenue,
);
