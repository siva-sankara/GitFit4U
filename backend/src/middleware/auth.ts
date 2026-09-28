import type { RequestHandler } from "express";
import { Session, RoleAssignment } from "../models/Auth.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { verifyAccessToken } from "../services/tokenService.js";
import { AppError } from "../utils/AppError.js";
import type { Permission, Role } from "../constants/domain.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "AUTH_REQUIRED", "Please sign in to continue.");
    }
    const claims = verifyAccessToken(header.slice(7));
    const [session, user] = await Promise.all([
      Session.findOne({
        publicId: claims.sid,
        userId: claims.sub,
        revokedAt: null,
      }),
      User.findById(claims.sub),
    ]);
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !user ||
      user.status !== "ACTIVE" ||
      !user.roles.includes(session.activeRole)
    ) {
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Your session is no longer active.",
      );
    }

    let permissions: Permission[] = [];
    if (session.activeRole === "ADMIN") {
      permissions = ["admin:platform"];
    } else if (
      ["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(session.activeRole)
    ) {
      // A stored owner role may start onboarding before any gym exists. This
      // session gets no tenant permissions; gym-scoped routes still require one.
      const onboardingOwner = session.activeRole === "GYM_OWNER" && !session.activeGymId;
      const assignment = onboardingOwner ? null : await RoleAssignment.findOne({
        userId: user._id,
        role: session.activeRole,
        gymId: session.activeGymId,
        status: "ACTIVE",
      });
      if (!onboardingOwner && !assignment)
        throw new AppError(
          403,
          "ROLE_REVOKED",
          "Your gym access has been removed.",
        );
      permissions = (assignment?.permissions || []) as Permission[];
    }

    req.auth = {
      userId: String(user._id),
      role: session.activeRole as Role,
      gymId: session.activeGymId ? String(session.activeGymId) : undefined,
      permissions,
      sessionId: session.publicId,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(
        new AppError(
          403,
          "ROLE_FORBIDDEN",
          "You do not have access to this area.",
        ),
      );
    }
    next();
  };
}

export const requireGymRegistration: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.auth || !(await User.exists({
      _id: req.auth.userId,
      status: "ACTIVE",
      roles: { $in: ["GYM_OWNER", "ADMIN"] },
    }))) throw new AppError(403, "ROLE_FORBIDDEN", "Gym registration requires a gym owner account.");
    next();
  } catch (error) {
    next(error);
  }
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (
      !req.auth?.permissions.includes(permission) &&
      !req.auth?.permissions.includes("admin:platform")
    ) {
      return next(
        new AppError(
          403,
          "PERMISSION_DENIED",
          "You do not have permission for this action.",
        ),
      );
    }
    next();
  };
}

export const requireGymContext: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.auth?.gymId) {
      throw new AppError(
        400,
        "GYM_CONTEXT_REQUIRED",
        "Select a gym to continue.",
      );
    }
    // Keep history readable and leave account/support/payment recovery routes
    // outside this tenant mutation guard. Never trust a previously issued
    // session as evidence that the gym is still allowed to make changes.
    if (
      req.auth.role !== "ADMIN" &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      const gym = await Gym.findById(req.auth.gymId)
        .select("status deletedAt")
        .lean();
      if (
        !gym ||
        gym.deletedAt ||
        ["SUSPENDED", "ARCHIVED"].includes(gym.status)
      ) {
        throw new AppError(
          403,
          "GYM_READ_ONLY",
          "This gym is unavailable for changes. History and subscription recovery remain accessible.",
        );
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};
