import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/whatsappController.js";

export const whatsappRoutes = Router();
whatsappRoutes.use(requireAuth);

const envelope = (body: z.ZodType = z.object({}), params: z.ZodType = z.object({}), query: z.ZodType = z.object({})) =>
  validate(z.object({ body, params, query }));
const id = z.string().min(6).max(120);
const manage = [requireRole("ADMIN", "GYM_OWNER", "GYM_STAFF"), requirePermission("gym:update")] as const;
const onboardingManage = [requireRole("ADMIN", "GYM_OWNER"), requirePermission("gym:update")] as const;
const inbox = [requireRole("ADMIN", "GYM_OWNER", "GYM_STAFF"), requirePermission("member:read")] as const;
const campaignManage = [requireRole("ADMIN", "GYM_OWNER", "GYM_STAFF"), requirePermission("campaign:write")] as const;

whatsappRoutes.get("/preferences", controller.preferences);
whatsappRoutes.put(
  "/preferences",
  envelope(z.object({ connectionId: id, service: z.boolean(), marketing: z.boolean() })),
  controller.updatePreference,
);
whatsappRoutes.get("/connection", ...manage, controller.connection);
whatsappRoutes.post(
  "/onboarding/start",
  ...onboardingManage,
  envelope(z.object({ connectionMode: z.enum(["STANDARD", "COEXISTENCE"]).default("STANDARD") })),
  controller.startOnboarding,
);
whatsappRoutes.post(
  "/onboarding/complete",
  ...onboardingManage,
  envelope(z.object({
    onboardingSessionId: id,
    state: z.string().min(20).max(100),
    code: z.string().min(8).max(4096).optional(),
    selectedPhoneNumberId: z.string().regex(/^\d{5,40}$/).optional(),
    sessionEvent: z.object({
      event: z.enum(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]),
      version: z.union([z.string().max(20), z.number().int().min(1).max(20)]).optional(),
      data: z.object({
        waba_id: z.string().regex(/^\d{5,40}$/),
        phone_number_id: z.string().regex(/^\d{5,40}$/).optional(),
        history_sharing: z.boolean().optional(),
        is_history_sharing_enabled: z.boolean().optional(),
      }),
    }).optional(),
  }).refine(
    (value) => Boolean(value.code || value.sessionEvent || value.selectedPhoneNumberId),
    "Provide an authorization code, a Meta session event or an approved phone selection.",
  )),
  controller.completeOnboarding,
);
whatsappRoutes.post("/onboarding/:id/cancel", ...onboardingManage, envelope(z.object({}), z.object({ id })), controller.cancelOnboarding);
whatsappRoutes.post("/connection/check", ...manage, envelope(), controller.checkConnection);
whatsappRoutes.patch(
  "/connection/outbound",
  ...manage,
  envelope(z.object({ paused: z.boolean(), reason: z.string().trim().max(500).optional() })),
  controller.updateOutbound,
);
const automatedEvents = [
  "invoice.ready", "membership.renewed", "membership.renewal_reminder", "class.booked", "class.cancelled",
  "class.updated", "class.trainer_changed", "class.reminder", "account.registered", "account.verified",
  "membership.created", "membership.activated", "membership.frozen", "membership.reactivated",
  "membership.deactivated", "membership.expiring", "membership.expired", "membership.cancelled",
  "payment.successful", "payment.offline", "payment.refunded", "trainer.assigned", "support.updated",
  "platform.expiring", "gym.activated", "gym.suspended", "gym.archived",
] as const;
whatsappRoutes.patch(
  "/connection/controls",
  ...manage,
  envelope(z.object({
    disabledEvents: z.array(z.enum(automatedEvents)).max(automatedEvents.length).transform((events) => [...new Set(events)]),
    dailyMessages: z.number().int().min(1).max(1_000_000),
    monthlyMessages: z.number().int().min(1).max(10_000_000),
    recipientPerDay: z.number().int().min(1).max(100),
    campaignMessages: z.number().int().min(1).max(100_000),
    concurrentSends: z.number().int().min(1).max(100),
    quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone."),
    estimatedMonthlyBudgetMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  })),
  controller.updateControls,
);
whatsappRoutes.delete(
  "/connection",
  ...manage,
  envelope(z.object({ reason: z.string().trim().min(3).max(500) })),
  controller.disconnect,
);
whatsappRoutes.get("/templates", ...inbox, controller.templates);
whatsappRoutes.post("/templates/sync", ...manage, envelope(), controller.syncTemplates);
whatsappRoutes.post(
  "/gym/members/:memberId/conversation",
  ...inbox,
  envelope(z.object({}), z.object({ memberId: id })),
  controller.openMemberConversation,
);
whatsappRoutes.get(
  "/conversations",
  ...inbox,
  envelope(z.any(), z.object({}), z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    q: z.string().trim().max(80).optional(),
    archived: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  })),
  controller.conversations,
);
whatsappRoutes.get("/conversations/:id", ...inbox, envelope(z.any(), z.object({ id })), controller.conversationDetails);
whatsappRoutes.get(
  "/conversations/:id/messages",
  ...inbox,
  envelope(z.any(), z.object({ id }), z.object({ before: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })),
  controller.messages,
);
whatsappRoutes.post(
  "/conversations/:id/messages",
  ...inbox,
  envelope(
    z.object({
      idempotencyKey: z.string().uuid(),
      purpose: z.enum(["SERVICE", "MARKETING"]).default("SERVICE"),
      text: z.string().trim().max(5000).optional(),
      templateName: z.string().regex(/^[a-z0-9_]{1,512}$/).optional(),
      language: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/).optional(),
      parameters: z.array(z.unknown()).max(20).optional(),
    }).refine((value) => Boolean(value.text) !== Boolean(value.templateName), "Choose message text or one approved template."),
    z.object({ id }),
  ),
  controller.sendMessage,
);
whatsappRoutes.post("/conversations/:id/read", ...inbox, envelope(z.object({}), z.object({ id })), controller.markRead);
whatsappRoutes.patch(
  "/conversations/:id/archive",
  ...inbox,
  envelope(z.object({ archived: z.boolean() }), z.object({ id })),
  controller.archive,
);
const campaignAudience = z.object({
  templateName: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/),
  roles: z.array(z.enum(["USER", "GYM_OWNER", "TRAINER", "GYM_STAFF"])).min(1).max(4).transform((roles) => [...new Set(roles)]),
});
whatsappRoutes.get("/campaigns", ...campaignManage, controller.campaigns);
whatsappRoutes.post("/campaigns/preview", ...campaignManage, envelope(campaignAudience), controller.campaignPreview);
whatsappRoutes.post(
  "/campaigns",
  ...campaignManage,
  envelope(campaignAudience.extend({
    name: z.string().trim().min(3).max(120),
    scheduledAt: z.string().datetime().optional(),
    idempotencyKey: z.string().uuid(),
    confirmed: z.literal(true),
  })),
  controller.createCampaign,
);
whatsappRoutes.post("/campaigns/:id/cancel", ...campaignManage, envelope(z.object({}), z.object({ id })), controller.cancelCampaign);
whatsappRoutes.get("/diagnostics", requireRole("ADMIN"), controller.diagnostics);
