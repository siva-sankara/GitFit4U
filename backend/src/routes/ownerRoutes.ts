import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { resendMemberInvitation } from "../controllers/accountInvitationController.js";
import { z } from "zod";
import * as controller from "../controllers/ownerController.js";
import * as members from "../controllers/memberManagementController.js";
import * as attendance from "../controllers/attendanceController.js";
import * as communication from "../controllers/memberCommunicationController.js";
import * as memberImports from "../controllers/memberImportController.js";
import * as ownerPayments from "../controllers/ownerPaymentController.js";
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
  requireGymRegistration,
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
ownerRoutes.use("/registrations", requireGymRegistration);
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
    !(base === "/members" && req.path.includes("/join/")) &&
    !(base === "/members" && req.path.includes("/communication/")) &&
    !(base === "/members" && req.path.includes("/import")) &&
    !(base === "/members" && req.path.endsWith("/export")) &&
    !(base === "/members" && req.path.includes("/bulk/")) &&
    !(base === "/gym" && req.path.includes("/media")) &&
    !req.path.endsWith("/invitation/resend") &&
    !(base === "/classes" && req.path.endsWith("/cancel"))
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
      .strict()
      .parse(req.body);
  next();
});

ownerRoutes.post(
  "/registrations",
  requireIdempotencyKey,
  validate(
    z.object({
      body: z.object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(4000).optional(),
        coordinates: coordinatesInput,
        timezone: gymInput.shape.timezone,
        contact: registrationContact.partial().optional(),
        address: registrationAddress.partial().optional(),
      }).strict(),
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
ownerRoutes.post("/members/:id/invitation/resend", requirePermission("member:write"), rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), resendMemberInvitation);
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
ownerRoutes.get("/gym/media", requirePermission("gym:read"), controller.listGymMedia);
ownerRoutes.patch("/gym/media/:mediaId", requirePermission("gym:update"), controller.updateGymMediaCaption);
ownerRoutes.delete("/gym/media/:mediaId", requirePermission("gym:update"), controller.deleteGymMedia);
ownerRoutes.get(
  "/members",
  requirePermission("member:read"),
  controller.listMembers,
);
const memberImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5_000_000, files: 1, fields: 5 },
  fileFilter: (_req, file, done) =>
    done(
      null,
      [".csv", ".xls", ".xlsx"].some((extension) =>
        file.originalname.toLowerCase().endsWith(extension),
      ),
    ),
});
const importRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: true,
  legacyHeaders: false,
});
ownerRoutes.get(
  "/members/import/template",
  requirePermission("member:write"),
  memberImports.memberImportTemplate,
);
ownerRoutes.post(
  "/members/import/preview",
  requirePermission("member:write"),
  importRateLimit,
  memberImportUpload.single("file"),
  memberImports.uploadMemberImport,
);
ownerRoutes.post(
  "/members/import/:importId/validate",
  requirePermission("member:write"),
  importRateLimit,
  memberImports.validateMemberImport,
);
ownerRoutes.post(
  "/members/import/:importId/confirm",
  requirePermission("member:write"),
  importRateLimit,
  requireIdempotencyKey,
  memberImports.confirmMemberImport,
);
ownerRoutes.get(
  "/members/import/:importId/errors",
  requirePermission("member:write"),
  memberImports.memberImportErrors,
);
ownerRoutes.post(
  "/members/export",
  requirePermission("member:read"),
  rateLimit({ windowMs: 15 * 60_000, limit: 20, keyGenerator: (req) => req.auth!.userId, standardHeaders: true, legacyHeaders: false }),
  memberImports.exportMembers,
);
ownerRoutes.post(
  "/members/bulk/assign-trainer",
  requirePermission("member:write"),
  requireIdempotencyKey,
  memberImports.bulkAssignTrainer,
);
ownerRoutes.post(
  "/members/bulk/notify",
  requirePermission("member:write"),
  rateLimit({ windowMs: 15 * 60_000, limit: 12, keyGenerator: (req) => req.auth!.userId, standardHeaders: true, legacyHeaders: false }),
  requireIdempotencyKey,
  memberImports.bulkNotifyMembers,
);
ownerRoutes.post(
  "/members/:id/communication/in-app",
  requirePermission("member:write"),
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    keyGenerator: (req) => req.auth!.userId,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  communication.openInAppConversation,
);
ownerRoutes.post(
  "/members/:id/communication/whatsapp-reminder",
  requirePermission("member:write"),
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  requireIdempotencyKey,
  validate(
    z.object({
      body: z
        .object({
          reason: z
            .enum([
              "activation_invitation",
              "renewal_reminder",
              "payment_reminder",
              "general_followup",
            ])
            .optional(),
          source: z.literal("members_list"),
        })
        .strict(),
      params: z.object({ id: z.string().min(3).max(64) }),
      query: z.object({}),
    }),
  ),
  communication.sendWhatsAppReminder,
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
ownerRoutes.delete(
  "/members/:id",
  requirePermission("member:write"),
  members.deleteMember,
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
          reason: z.string().trim().max(500).optional(),
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
ownerRoutes.post(
  "/classes/:id/cancel",
  requirePermission("class:write"),
  controller.cancelClass,
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
  "/classes/:id/bookings",
  requirePermission("gym:read"),
  controller.listClassBookings,
);
ownerRoutes.post(
  "/payments/:id/collect",
  requirePermission("finance:read"),
  requirePermission("member:write"),
  requireIdempotencyKey,
  ownerPayments.collectPayment,
);
ownerRoutes.post(
  "/payments/:id/reminder",
  requirePermission("finance:read"),
  requirePermission("member:write"),
  requireIdempotencyKey,
  ownerPayments.remindPayment,
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
ownerRoutes.patch("/ads/:id", requirePermission("campaign:write"), controller.updateAd);
ownerRoutes.get(
  "/revenue",
  requirePermission("finance:read"),
  controller.revenue,
);
