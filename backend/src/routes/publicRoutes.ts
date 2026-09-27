import { Router } from "express";
import * as controller from "../controllers/publicController.js";
import { PlatformSettings } from "../models/Operations.js";

export const publicRoutes = Router();
publicRoutes.get("/settings", async (_req, res) => {
  const values =
    (await PlatformSettings.findOne({ key: "platform" }).lean())?.values || {};
  res.json({
    success: true,
    data: {
      supportEmail: values.supportEmail,
      supportPhone: values.supportPhone,
      maintenanceNotice: values.maintenanceNotice,
    },
  });
});
publicRoutes.get("/gyms", controller.listGyms);
publicRoutes.get("/gyms/nearby", controller.nearbyGyms);
publicRoutes.get("/gyms/:slug/reviews", controller.gymReviews);
publicRoutes.get("/gyms/:slug", controller.gymDetails);
