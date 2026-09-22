import { Router } from "express";
import { z } from "zod";
import * as controller from "../controllers/userController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as feature from "../controllers/memberFeatureController.js";
import { reviewInput } from "./inputSchemas.js";

export const userRoutes = Router();
userRoutes.use(requireAuth, requireRole("USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"));
userRoutes.use((req, _res, next) => { if (req.method === "PATCH" && req.path.startsWith("/me/reviews/")) req.body = reviewInput.parse(req.body); next(); });
userRoutes.get("/me", controller.getProfile);
userRoutes.patch(
  "/me",
  validate(
    z.object({
      body: z.object({
        name: z.string().min(2).max(120).optional(),
        avatarUrl: z.string().url().optional(),
        profile: z
          .object({
            dateOfBirth: z.coerce.date().optional(),
            gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]).optional(),
            heightCm: z.number().min(50).max(260).optional(),
            weightKg: z.number().min(20).max(400).optional(),
            fitnessGoal: z.string().max(200).optional(),
            emergencyContact: z.object({ name: z.string(), phone: z.string(), relationship: z.string() }).optional()
          })
          .optional()
      }),
      params: z.object({}),
      query: z.object({})
    })
  ),
  controller.updateProfile
);
userRoutes.get("/me/subscriptions", controller.subscriptions);
userRoutes.get("/me/subscriptions/:id", controller.subscriptionDetails);
userRoutes.get("/me/payments", controller.payments);
userRoutes.get("/me/attendance", controller.attendance);
userRoutes.post("/me/attendance/qr", validate(z.object({ body: z.object({ gymId: z.string().regex(/^[a-f\d]{24}$/i) }), params: z.object({}), query: z.object({}) })), controller.attendanceQr);
userRoutes.get("/me/notifications", controller.notifications);
userRoutes.post("/me/notifications/:id/read", controller.markNotificationRead);
userRoutes.post("/me/notifications/read-all", controller.markAllNotificationsRead);
userRoutes.post(
  "/me/support-tickets",
  validate(z.object({ body: z.object({ subject: z.string().min(5).max(160), message: z.string().min(10).max(5000), category: z.string().max(60).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), gymId: z.string().optional() }), params: z.object({}), query: z.object({}) })),
  controller.createSupportTicket
);
userRoutes.get("/me/favorites",feature.favorites); userRoutes.post("/me/favorites/:gymId",feature.addFavorite); userRoutes.delete("/me/favorites/:gymId",feature.removeFavorite);
userRoutes.post("/me/reviews",validate(z.object({body:z.object({gymId:z.string(),rating:z.number().int().min(1).max(5),title:z.string().max(160).optional(),body:z.string().max(3000).optional(),photoUrls:z.array(z.string().url()).max(8).optional()}),params:z.object({}),query:z.object({})})),feature.createReview); userRoutes.patch("/me/reviews/:id",feature.updateReview);
userRoutes.get("/classes",feature.classes); userRoutes.post("/classes/:id/bookings",feature.bookClass); userRoutes.delete("/classes/:id/bookings/:bookingId",feature.cancelBooking);
userRoutes.post("/me/subscriptions/:id/:command",validate(z.object({body:z.object({planId:z.string().optional(),couponCode:z.string().max(30).optional(),startsAt:z.coerce.date().optional(),endsAt:z.coerce.date().optional(),reason:z.string().max(1000).optional()}),params:z.object({id:z.string(),command:z.enum(["cancel","freeze","renew","change-plan"])}),query:z.object({})})),feature.subscriptionCommand);
userRoutes.get("/me/referrals",feature.referrals); userRoutes.post("/me/referrals",validate(z.object({body:z.object({code:z.string().min(4).max(40)}),params:z.object({}),query:z.object({})})),feature.inviteReferral);
