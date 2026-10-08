import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as controller from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requireCsrfProtection } from "../middleware/csrf.js";
import { activateAccount, acceptInvitation } from "../controllers/accountInvitationController.js";
import { accountPassword, publicSignupInput } from "./authSchemas.js";

export const authRoutes = Router();
authRoutes.use((_req, res, next) => {
  // Authentication and identity responses must never be reused by a browser,
  // CDN, or the same-origin Vercel proxy for another request.
  res.set("Cache-Control", "no-store");
  next();
});
authRoutes.use(requireCsrfProtection);

const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
// Status is polled every five seconds while an OTP screen is open. Keep this
// separate from mutation throttling so ordinary polling cannot consume the
// request/resend/verification budget.
const otpStatusLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

const password = accountPassword;
const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/);
const otpIdentifier = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .refine(
    (value) =>
      value.includes("@")
        ? z.string().email().safeParse(value).success
        : /^\+?[0-9 ()-]{8,20}$/.test(value),
    "Enter a valid email address or mobile number.",
  );
const otpIdentifierBody = z
  .object({
    identifier: otpIdentifier.optional(),
    // Keep the previous request shape during rollout; new clients use identifier.
    phone: otpIdentifier.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.identifier || value.phone), {
    message: "Email address or mobile number is required.",
  });
authRoutes.post("/activate-account", loginLimiter, validate(z.object({ body: z.object({ token: invitationToken, password }).strict(), params: z.object({}), query: z.object({}) })), activateAccount);
authRoutes.post("/accept-invitation", loginLimiter, requireAuth, validate(z.object({ body: z.object({ token: invitationToken }).strict(), params: z.object({}), query: z.object({}) })), acceptInvitation);
authRoutes.post("/register", loginLimiter, validate(z.object({ body: publicSignupInput, params:z.object({}), query:z.object({}) })), controller.register);
authRoutes.post("/signup/verify", otpLimiter, validate(z.object({ body: z.object({ operationId: z.string().min(20).max(40), challengeId: z.string().min(20).max(40), code: z.string().regex(/^\d{6}$/) }).strict(), params:z.object({}), query:z.object({}) })), controller.verifySignupOtp);
authRoutes.post("/signup/resend", otpLimiter, validate(z.object({ body: z.object({ operationId: z.string().min(20).max(40) }).strict(), params:z.object({}), query:z.object({}) })), controller.resendSignupOtp);
authRoutes.post("/signup/cancel", otpLimiter, validate(z.object({ body: z.object({ operationId: z.string().min(20).max(40) }).strict(), params:z.object({}), query:z.object({}) })), controller.cancelSignup);
authRoutes.post("/login", loginLimiter, validate(z.object({ body: z.object({ identifier: z.string().min(3).max(160), password: z.string().min(1).max(128) }), params:z.object({}), query:z.object({}) })), controller.passwordLogin);
authRoutes.post("/forgot-password", otpLimiter, validate(z.object({ body: otpIdentifierBody, params:z.object({}), query:z.object({}) })), controller.forgotPassword);
authRoutes.post("/recovery/verify", otpLimiter, validate(z.object({ body: z.object({ challengeId: z.string().min(8), code: z.string().regex(/^\d{6}$/) }), params:z.object({}), query:z.object({}) })), controller.verifyRecoveryOtp);
authRoutes.post("/reset-password", loginLimiter, validate(z.object({ body: z.object({ resetToken: z.string().min(30), password }), params:z.object({}), query:z.object({}) })), controller.resetPassword);

authRoutes.post(
  "/otp/request",
  otpLimiter,
  validate(z.object({ body: otpIdentifierBody, params: z.object({}), query: z.object({}) })),
  controller.otpRequest
);
authRoutes.get(
  "/otp/:challengeId/status",
  otpStatusLimiter,
  validate(z.object({ body: z.object({}).optional(), params: z.object({ challengeId: z.string().min(20).max(40) }), query: z.object({}) })),
  controller.otpStatus,
);
authRoutes.post(
  "/otp/verify",
  otpLimiter,
  validate(z.object({ body: z.object({ challengeId: z.string().min(8), code: z.string().regex(/^\d{6}$/) }), params: z.object({}), query: z.object({}) })),
  controller.otpVerify
);
authRoutes.post(
  "/google",
  loginLimiter,
  validate(z.object({ body: z.object({ idToken: z.string().min(20) }), params: z.object({}), query: z.object({}) })),
  controller.googleLogin
);
authRoutes.post("/refresh", controller.refresh);
authRoutes.post("/logout", controller.logout);
authRoutes.post("/logout-all", requireAuth, controller.logoutAll);
authRoutes.get("/me", requireAuth, controller.me);
authRoutes.get("/sessions", requireAuth, controller.sessions);
authRoutes.delete("/sessions/:sessionId", requireAuth, controller.revokeSession);
authRoutes.post(
  "/switch-role",
  requireAuth,
  validate(z.object({ body: z.object({ role: z.enum(["USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"]), gymId: z.string().optional() }), params: z.object({}), query: z.object({}) })),
  controller.switchRole
);
