import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GymScanner } from "../models/Attendance.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { issueGymQr, verifyGymQr } from "../services/attendanceQrService.js";
import { checkIn } from "../services/attendanceService.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";

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
    "name status logoUrl attendanceLocationRequired",
  );
  if (!gym || gym.status !== "ACTIVE")
    throw new AppError(
      409,
      "GYM_NOT_ACTIVE",
      "Activate this gym before displaying its attendance QR.",
    );
  const identity = await GymScanner.findOneAndUpdate(
    { gymId: gym._id, kind: "GYM_IDENTITY" },
    {
      $setOnInsert: {
        publicId: nanoid(24),
        name: "Gym attendance identity",
        secretVersion: 1,
        status: "ACTIVE",
      },
    },
    { upsert: true, new: true },
  );
  res.json({
    success: true,
    data: {
      token: issueGymQr(
        String(gym._id),
        identity.publicId,
        identity.secretVersion,
      ),
      gymName: gym.name,
      logoUrl: gym.logoUrl,
      revision: identity.secretVersion,
      locationRequired: gym.attendanceLocationRequired,
    },
  });
}
export async function rotateGymQr(req: Request, res: Response) {
  const identity = await GymScanner.findOneAndUpdate(
    { gymId: req.auth!.gymId, kind: "GYM_IDENTITY" },
    { $inc: { secretVersion: 1 }, $set: { status: "ACTIVE" } },
    { new: true },
  );
  if (!identity)
    throw new AppError(
      404,
      "QR_NOT_FOUND",
      "Display the gym QR before replacing it.",
    );
  await writeAudit(req, {
    action: "gym.qr.rotated",
    entityType: "GymScanner",
    entityId: identity.publicId,
  });
  return getGymQr(req, res);
}
export async function memberCheckIn(req: Request, res: Response) {
  const body = memberCheckInInput.parse(req.body);
  const qr = verifyGymQr(body.qrToken);
  const identity = await GymScanner.findOne({
    gymId: qr.gymId,
    publicId: qr.identityId,
    kind: "GYM_IDENTITY",
    status: "ACTIVE",
    secretVersion: qr.revision,
  });
  if (!identity)
    throw new AppError(
      410,
      "QR_REVOKED",
      "This gym QR has been replaced. Scan the latest code at reception.",
    );
  const member = await MemberProfile.findOne({
    gymId: qr.gymId,
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
    gymId: qr.gymId,
    memberIdentifier: member.publicId,
    actorId: req.auth!.userId,
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
