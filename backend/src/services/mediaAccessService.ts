import type { Request } from "express";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
export async function assertTenantMediaAccess(req: Request, purpose: string, gymId: unknown = req.auth?.gymId) {
  const permission = purpose.startsWith("GYM_") ? "gym:update" : purpose === "TRAINER_IMAGE" ? "class:write" : purpose === "MEMBER_AVATAR" ? "member:write" : purpose === "AD" ? "campaign:write" : undefined;
  if (!permission) return;
  const admin = req.auth?.role === "ADMIN" && req.auth.permissions.includes("admin:platform");
  if (!gymId || (!admin && (!req.auth?.gymId || String(gymId) !== req.auth.gymId || !req.auth.permissions.includes(permission))))
    throw new AppError(403, "TENANT_MEDIA_FORBIDDEN", "Select the gym whose media you have permission to manage.");
  if (!await Gym.exists({ _id: gymId, deletedAt: null, status: { $nin: ["SUSPENDED", "ARCHIVED"] } }))
    throw new AppError(403, "GYM_READ_ONLY", "This gym is unavailable for media changes.");
}
