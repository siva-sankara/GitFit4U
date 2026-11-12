import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/messagingController.js";
import { supportManagement, updateSupportWorkflow, addInternalNote } from "../controllers/supportManagementController.js";

export const messagingRoutes = Router();
const id = z.string().min(6).max(120);
const schema = (body: z.ZodType, params: z.ZodType = z.object({ id })) =>
  validate(z.object({ body, params, query: z.object({}) }));
messagingRoutes.use(requireAuth);
const contactLimiter = rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: req => req.auth!.userId, standardHeaders: "draft-8", legacyHeaders: false });
messagingRoutes.get("/contacts", contactLimiter, validate(z.object({ body: z.any(), params: z.object({}), query: z.object({
  q: z.string().trim().max(80).default("").refine(value => !value || value.length >= 2, "Enter at least two characters."),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
}) })), controller.listContacts);
messagingRoutes.get(
  "/broadcasts",
  requireRole("ADMIN"),
  controller.listBroadcasts,
);
messagingRoutes.post(
  "/broadcasts",
  requireRole("ADMIN"),
  schema(
    z.object({
      name: z.string().trim().min(3).max(120),
      message: z.string().trim().min(5).max(5000),
      roles: z
        .array(z.enum(["USER", "GYM_OWNER", "TRAINER", "GYM_STAFF"]))
        .min(1)
        .max(4)
        .transform((values) => [...new Set(values)].sort()),
      idempotencyKey: z.string().uuid(),
    }),
    z.object({}),
  ),
  controller.createBroadcast,
);
messagingRoutes.get("/", controller.listConversations);
messagingRoutes.post(
  "/",
  contactLimiter,
  schema(
    z.object({
      participantIds: z
        .array(z.string().regex(/^[a-f\d]{24}$/i))
        .min(1)
        .max(50),
      type: z.enum(["DIRECT", "GROUP"]).default("DIRECT"),
      title: z.string().trim().min(2).max(120).optional(),
    }),
    z.object({}),
  ),
  controller.createConversation,
);
messagingRoutes.get("/:id/messages", controller.listMessages);
messagingRoutes.get("/:id/support-management", supportManagement);
messagingRoutes.patch("/:id/support-management", updateSupportWorkflow);
messagingRoutes.post("/:id/internal-notes", addInternalNote);
messagingRoutes.get("/:id", controller.conversationDetails);
messagingRoutes.post(
  "/:id/messages",
  schema(
    z
      .object({
        clientMessageId: z.string().min(8).max(120),
        type: z.enum(["TEXT", "IMAGE", "FILE"]).default("TEXT"),
        text: z.string().trim().max(5000).optional(),
        attachments: z
          .array(
            z.object({
              key: z.string().min(1).max(500),
              url: z.string().url().optional(),
              name: z.string().optional(),
              mimeType: z.string().optional(),
              size: z.number().positive().optional(),
            }),
          )
          .max(10)
          .optional(),
      })
      .refine(
        (value) => value.text || value.attachments?.length,
        "Message text or attachment is required",
      ),
  ),
  controller.sendMessage,
);
messagingRoutes.post("/:id/read", controller.markRead);
messagingRoutes.delete("/:id", controller.archiveConversation);
messagingRoutes.post("/:id/restore", controller.restoreConversation);
messagingRoutes.delete("/:id/messages/:messageId", controller.deleteMessage);
messagingRoutes.patch(
  "/:id/support-status",
  schema(
    z.object({
      status: z.enum([
        "OPEN",
        "IN_PROGRESS",
        "WAITING_FOR_USER",
        "RESOLVED",
        "CLOSED",
      ]),
    }),
  ),
  updateSupportWorkflow,
);
