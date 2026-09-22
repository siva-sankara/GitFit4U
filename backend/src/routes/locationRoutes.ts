import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { validate } from "../middleware/validate.js";
import * as controller from "../controllers/locationController.js";
export const locationRoutes = Router();
locationRoutes.get("/config", controller.config);
locationRoutes.get(
  "/tiles/:z/:x/:y",
  rateLimit({
    windowMs: 60000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  validate(
    z.object({
      body: z.object({}).optional(),
      query: z.object({}),
      params: z
        .object({
          z: z.coerce.number().int().min(0).max(19),
          x: z.coerce.number().int().nonnegative(),
          y: z.coerce.number().int().nonnegative(),
        })
        .refine((p) => p.x < 2 ** p.z && p.y < 2 ** p.z, "Invalid map tile"),
    }),
  ),
  controller.tile,
);
locationRoutes.use(
  rateLimit({
    windowMs: 60000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
locationRoutes.get(
  "/autocomplete",
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({}),
      query: z.object({
        q: z.string().trim().min(2).max(200),
        sessionToken: z.string().max(100).optional(),
      }),
    }),
  ),
  controller.autocomplete,
);
locationRoutes.post(
  "/geocode",
  validate(
    z.object({
      body: z.object({ address: z.string().trim().min(3).max(500) }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.geocode,
);
locationRoutes.post(
  "/reverse-geocode",
  validate(
    z.object({
      body: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.reverse,
);
locationRoutes.post(
  "/directions",
  validate(
    z.object({
      body: z.object({
        origin: z.string().min(3).max(500),
        destination: z.string().min(3).max(500),
        mode: z.enum(["driving", "walking"]).default("driving"),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.directions,
);
