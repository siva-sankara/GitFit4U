import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/deviceController.js";
export const deviceRoutes = Router();
deviceRoutes.use(requireAuth);
deviceRoutes.get("/status", controller.status);
deviceRoutes.post(
  "/",
  validate(
    z.object({
      body: z.object({
        token: z.string().min(20).max(4096),
        platform: z.enum(["WEB", "ANDROID", "IOS"]),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.register,
);
deviceRoutes.delete(
  "/",
  validate(
    z.object({
      body: z.object({ token: z.string().min(20).max(4096) }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.revoke,
);
