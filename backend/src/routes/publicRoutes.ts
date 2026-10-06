import { Router } from "express";
import * as controller from "../controllers/publicController.js";
import { PlatformSettings } from "../models/Operations.js";
import { publicAds, publicOffers } from "../controllers/promotionController.js";
import { requireAuth } from "../middleware/auth.js";

export const publicRoutes = Router();
publicRoutes.get("/promotions/offers", publicOffers);
publicRoutes.get("/promotions/ads", (req, res, next) => req.header("authorization") ? requireAuth(req, res, next) : next(), publicAds);
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
publicRoutes.get("/gyms/:slug/media", controller.gymMedia);
publicRoutes.get("/gyms/:slug/classes", controller.gymClasses);
publicRoutes.get("/gyms/:slug/plans", controller.gymPlans);
publicRoutes.get("/gyms/:slug", controller.gymDetails);
