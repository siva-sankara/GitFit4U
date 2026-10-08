import { Router } from "express";
import { z } from "zod";
import * as controller from "../controllers/checkoutController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { validate } from "../middleware/validate.js";
import { eligiblePlatformOffers } from "../controllers/platformOfferController.js";

export const checkoutRoutes = Router();
checkoutRoutes.use(requireAuth);
checkoutRoutes.get("/platform/offers", eligiblePlatformOffers);
const offerSelection = { couponCode: z.string().trim().min(1).max(30).optional(), offerId: z.string().min(1).max(30).optional() };
checkoutRoutes.post(
  "/platform/quotes",
  validate(
    z.object({
      body: z.object({
        registrationId: z.string().min(1),
        ...offerSelection,
        planId: z.string().regex(/^[a-f\d]{24}$/i),
      }).strict().or(z.object({ ...offerSelection, renewal: z.literal(true), planId: z.string().regex(/^[a-f\d]{24}$/i), expectedGymId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).strict()).refine(body => !(body.couponCode && body.offerId), "Apply one offer at a time."),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createPlatformQuote,
);
checkoutRoutes.post(
  "/platform/orders",
  requireIdempotencyKey,
  validate(
    z.object({
      body: z.object({ quoteId: z.string().min(1) }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createOrder,
);
checkoutRoutes.post(
  "/quotes",
  validate(
    z.object({
      body: z.object({
        gymId: z.string(),
        planId: z.string(),
        couponCode: z.string().max(30).optional(),
        offerId: z.string().max(30).optional(),
      }).strict(),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createQuote,
);
checkoutRoutes.post(
  "/orders",
  requireIdempotencyKey,
  validate(
    z.object({
      body: z.object({ quoteId: z.string() }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.createOrder,
);
checkoutRoutes.get("/payments/:id", controller.paymentStatus);
checkoutRoutes.post("/payments/:id/cancel", controller.cancelCheckout);
checkoutRoutes.post(
  "/verify",
  validate(
    z.object({
      body: z.object({
        paymentId: z.string(),
        providerOrderId: z.string(),
        providerPaymentId: z.string(),
        signature: z.string().min(32),
      }),
      params: z.object({}),
      query: z.object({}),
    }),
  ),
  controller.verifyCheckout,
);
