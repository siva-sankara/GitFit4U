import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/uploadController.js";
export const uploadRoutes = Router();
uploadRoutes.use(requireAuth);
uploadRoutes.post(
  "/",
  validate(
    z.object({
      body: z.object({
        registrationId: z.string().min(8).max(64).optional(),
        name: z.string().min(1).max(255),
        mimeType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "video/mp4",
        ]),
        size: z.number().int().positive().max(50_000_000),
        purpose: z.enum([
          "AVATAR",
          "GYM_LOGO",
          "GYM_COVER",
          "GYM_GALLERY",
          "DOCUMENT",
          "REVIEW",
          "MESSAGE",
          "PROGRESS",
          "AD",
        ]),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.initiate,
);
uploadRoutes.post(
  "/:id/complete",
  validate(
    z.object({
      body: z.object({ checksum: z.string().max(256).optional() }),
      params: z.object({ id: z.string() }),
      query: z.object({}),
    }),
  ),
  controller.complete,
);
uploadRoutes.delete("/:id", controller.remove);
