import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as controller from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requireCsrfProtection } from "../middleware/csrf.js";

export const authRoutes = Router();
authRoutes.use(requireCsrfProtection);

const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

const password = z.string().min(10).max(128).regex(/[A-Z]/, "One uppercase letter is required").regex(/[a-z]/, "One lowercase letter is required").regex(/\d/, "One number is required");
authRoutes.post("/register", loginLimiter, validate(z.object({ body: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email(), phone: z.string().trim().min(8).max(20).optional(), password }), params:z.object({}), query:z.object({}) })), controller.register);
authRoutes.post("/login", loginLimiter, validate(z.object({ body: z.object({ identifier: z.string().min(3).max(160), password: z.string().min(1).max(128) }), params:z.object({}), query:z.object({}) })), controller.passwordLogin);
authRoutes.post("/forgot-password", otpLimiter, validate(z.object({ body: z.object({ phone: z.string().min(8).max(20) }), params:z.object({}), query:z.object({}) })), controller.forgotPassword);
authRoutes.post("/recovery/verify", otpLimiter, validate(z.object({ body: z.object({ challengeId: z.string().min(8), code: z.string().regex(/^\d{6}$/) }), params:z.object({}), query:z.object({}) })), controller.verifyRecoveryOtp);
authRoutes.post("/reset-password", loginLimiter, validate(z.object({ body: z.object({ resetToken: z.string().min(30), password }), params:z.object({}), query:z.object({}) })), controller.resetPassword);

authRoutes.post(
  "/otp/request",
  otpLimiter,
  validate(z.object({ body: z.object({ phone: z.string().min(8).max(20), purpose: z.enum(["LOGIN", "STEP_UP", "ACCOUNT_RECOVERY"]).default("LOGIN") }), params: z.object({}), query: z.object({}) })),
  controller.otpRequest
);
authRoutes.post(
  "/otp/verify",
  otpLimiter,
  validate(z.object({ body: z.object({ challengeId: z.string().min(8), code: z.string().regex(/^\d{6}$/) }), params: z.object({}), query: z.object({}) })),
  controller.otpVerify
);
authRoutes.post(
  "/google",
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
