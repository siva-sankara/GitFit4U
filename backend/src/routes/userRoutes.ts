import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { profileUpdateInput } from "./profileSchemas.js";
import * as contact from "../controllers/profileContactController.js";
import * as controller from "../controllers/userController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as feature from "../controllers/memberFeatureController.js";
import { reviewInput } from "./inputSchemas.js";
import {
  memberCheckIn,
  deprecatedMemberQr,
} from "../controllers/attendanceController.js";
import { requestGymJoin } from "../controllers/memberManagementController.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { deleteNotifications, notificationDetails } from "../controllers/notificationController.js";

export const userRoutes = Router();
userRoutes.use(
  requireAuth,
  requireRole("USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"),
);
userRoutes.use((req, _res, next) => {
  if (req.method === "PATCH" && req.path.startsWith("/me/reviews/"))
    req.body = reviewInput.parse(req.body);
  next();
});
userRoutes.get("/me", controller.getProfile);
userRoutes.get("/me/reviews", feature.ownReview);
userRoutes.patch("/me", validate(z.object({ body: profileUpdateInput, params: z.object({}), query: z.object({}) })), controller.updateProfile);
const contactLimit = rateLimit({ windowMs: 15 * 60000, limit: 8, keyGenerator: req => req.auth!.userId, standardHeaders: "draft-8", legacyHeaders: false });
userRoutes.post("/me/contact/phone/request", contactLimit, contact.requestPhoneChange);
userRoutes.post("/me/contact/phone/confirm", contactLimit, contact.confirmPhoneChange);
userRoutes.post("/me/contact/email", contactLimit, contact.changeEmail);
userRoutes.get("/me/subscriptions", controller.subscriptions);
userRoutes.get("/me/subscriptions/:id", controller.subscriptionDetails);
userRoutes.get("/me/payments", controller.payments);
userRoutes.get("/me/attendance", controller.attendance);
userRoutes.post("/me/attendance/qr", deprecatedMemberQr);
userRoutes.post(
  "/me/attendance/check-in",
  requireIdempotencyKey,
  memberCheckIn,
);
userRoutes.post("/me/gym-join-requests", requestGymJoin);
userRoutes.get("/me/notifications", controller.notifications);
userRoutes.get("/me/notifications/:id", notificationDetails);
userRoutes.delete("/me/notifications", deleteNotifications);
userRoutes.delete("/me/notifications/:id", deleteNotifications);
userRoutes.post("/me/notifications/:id/read", controller.markNotificationRead);
userRoutes.post(
  "/me/notifications/read-all",
  controller.markAllNotificationsRead,
);
userRoutes.post(
  "/me/support-tickets",
  validate(
    z.object({
      body: z.object({
        subject: z.string().min(5).max(160),
        message: z.string().min(10).max(5000),
        category: z.string().max(60).optional(),
        priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
        gymId: z.string().optional(),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createSupportTicket,
);
userRoutes.get("/me/favorites", feature.favorites);
userRoutes.post("/me/favorites/:gymId", feature.addFavorite);
userRoutes.delete("/me/favorites/:gymId", feature.removeFavorite);
userRoutes.post(
  "/me/reviews",
  validate(
    z.object({
      body: reviewInput.extend({ gymId: z.string().min(3).max(64) }).strict(),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  feature.createReview,
);
userRoutes.patch("/me/reviews/:id", feature.updateReview);
userRoutes.get("/classes", feature.classes);
userRoutes.get("/classes/bookings/:bookingId", feature.bookingDetails);
userRoutes.get("/classes/:id", feature.classDetails);
userRoutes.post("/classes/:id/bookings", feature.bookClass);
userRoutes.delete("/classes/:id/bookings/:bookingId", feature.cancelBooking);
userRoutes.post(
  "/me/subscriptions/:id/:command",
  validate(
    z.object({
      body: z.object({
        planId: z.string().optional(),
        couponCode: z.string().max(30).optional(),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        reason: z.string().max(1000).optional(),
      }),
      params: z.object({
        id: z.string(),
        command: z.enum([
          "cancel",
          "freeze",
          "reactivate",
          "renew",
          "change-plan",
        ]),
      }),
      query: z.object({}),
    }),
  ),
  feature.subscriptionCommand,
);
userRoutes.get("/me/referrals", feature.referrals);
userRoutes.post(
  "/me/referrals",
  validate(
    z.object({
      body: z.object({ code: z.string().min(4).max(40) }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  feature.inviteReferral,
);
