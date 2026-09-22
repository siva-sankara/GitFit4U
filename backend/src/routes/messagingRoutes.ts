import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/messagingController.js";

export const messagingRoutes = Router();
messagingRoutes.use(requireAuth);
messagingRoutes.get("/", controller.listConversations);
messagingRoutes.post("/", validate(z.object({ body: z.object({ participantIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(50), type: z.enum(["DIRECT", "GROUP", "SUPPORT"]).default("DIRECT"), title: z.string().min(2).max(120).optional() }), params: z.object({}), query: z.object({}) })), controller.createConversation);
messagingRoutes.get("/:id/messages", controller.listMessages);
messagingRoutes.post("/:id/messages", validate(z.object({ body: z.object({ clientMessageId: z.string().min(8).max(120), type: z.enum(["TEXT", "IMAGE", "FILE"]).default("TEXT"), text: z.string().max(5000).optional(), attachments: z.array(z.object({ key: z.string(), url: z.string().url(), name: z.string(), mimeType: z.string(), size: z.number().positive() })).max(10).optional() }).refine(v => v.text?.trim() || v.attachments?.length, "Message text or attachment is required"), params: z.object({ id: z.string().min(6) }), query: z.object({}) })), controller.sendMessage);
messagingRoutes.post("/:id/read", controller.markRead);
