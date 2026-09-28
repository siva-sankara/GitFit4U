import type { Request, Response } from "express";
import { z } from "zod";
import { GymScanner } from "../models/Attendance.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { parseGymQrReference } from "../services/attendanceQrService.js";
import { permanentGymIdentity } from "../services/gymQrIdentityService.js";
import { checkIn } from "../services/attendanceService.js";
import { AppError } from "../utils/AppError.js";

export const memberCheckInInput = z.object({
  qrToken: z.string().min(20).max(2048),
  location: z
    .object({
      coordinates: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ]),
      accuracyMeters: z.number().nonnegative().max(5000),
      capturedAt: z.coerce.date(),
    })
    .optional(),
});
export async function getGymQr(req: Request, res: Response) {
  const gym = await Gym.findById(req.auth!.gymId).select(
    "name status deletedAt logoUrl attendanceLocationRequired",
  );
  if (!gym || gym.deletedAt || gym.status !== "ACTIVE")
    throw new AppError(
      409,
      "GYM_NOT_ACTIVE",
      "Activate this gym before displaying its attendance QR.",
    );
  const identity = await permanentGymIdentity(String(gym._id));
  res.json({
    success: true,
    data: {
      token: identity.qrPayload,
      gymName: gym.name,
      logoUrl: gym.logoUrl,
      revision: identity.secretVersion,
      locationRequired: gym.attendanceLocationRequired,
    },
  });
}
export async function rotateGymQr(_req: Request, _res: Response) {
  throw new AppError(410, "QR_PERMANENT", "Your gym QR is permanent. Display or download the existing QR.");
}
export async function memberCheckIn(req: Request, res: Response) {
  const body = memberCheckInInput.parse(req.body);
  const qr = parseGymQrReference(body.qrToken);
  const identity = await GymScanner.findOne({
    ...(qr.gymId ? { gymId: qr.gymId } : {}),
    publicId: qr.identityId,
    kind: "GYM_IDENTITY",
    status: "ACTIVE",
    ...(qr.revision ? { secretVersion: qr.revision } : {}),
  });
  if (!identity)
    throw new AppError(
      410,
      "QR_REVOKED",
      "This gym QR is unavailable. Ask reception to check the gym's attendance access.",
    );
  const member = await MemberProfile.findOne({
    gymId: identity.gymId,
    userId: req.auth!.userId,
    status: "ACTIVE",
  }).select("publicId");
  if (!member)
    throw new AppError(
      403,
      "MEMBERSHIP_REQUIRED",
      "You need an approved membership at this gym to check in.",
    );
  const result = await checkIn({
    gymId: String(identity.gymId),
    memberIdentifier: member.publicId,
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
    memberUserId: req.auth!.userId,
    source: "QR",
    scannerId: String(identity._id),
    idempotencyKey: req.idempotencyKey,
    location: body.location,
  });
  res
    .status(result.duplicate ? 200 : 201)
    .json({ success: true, data: result });
}
export async function deprecatedMemberQr(_req: Request, _res: Response) {
  throw new AppError(
    410,
    "ATTENDANCE_FLOW_CHANGED",
    "Open Scan gym QR and scan the code displayed at your gym.",
  );
}

export async function adminManualCheckIn(req: Request, res: Response) {
  if (req.auth?.role !== "ADMIN" || !req.auth.permissions.includes("admin:platform")) throw new AppError(403, "ROLE_FORBIDDEN", "Administrator access is required.");
  const body = z.object({ memberIdentifier: z.string().min(3).max(80), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  const gym = await Gym.findOne({ publicId: req.params.gymId, deletedAt: null }).select("_id");
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  const result = await checkIn({ gymId: String(gym._id), memberIdentifier: body.memberIdentifier, actorId: req.auth!.userId, actorRole: req.auth!.role, reason: body.reason, source: "MANUAL", idempotencyKey: req.idempotencyKey });
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
}
