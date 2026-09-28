import { pushConfigured } from "../integrations/notifications/firebaseProvider.js";
import type { Request, Response } from "express";
import { sha256 } from "../utils/crypto.js";
import { DeviceToken } from "../models/Collaboration.js";
export async function register(req: Request, res: Response) {
  const data = await DeviceToken.findOneAndUpdate(
    { tokenHash: sha256(req.body.token) },
    {
      $set: {
        userId: req.auth!.userId,
        sessionId: req.auth!.sessionId,
        deviceId: req.body.deviceId,
        token: req.body.token,
        platform: req.body.platform,
        permission: "GRANTED",
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  ).select("-token");
  if (req.body.deviceId)
    await DeviceToken.updateMany(
      {
        userId: req.auth!.userId,
        deviceId: req.body.deviceId,
        tokenHash: { $ne: sha256(req.body.token) },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
    );
  res
    .status(201)
    .json({
      success: true,
      data: {
        _id: data._id,
        platform: data.platform,
        permission: data.permission,
        lastSeenAt: data.lastSeenAt,
      },
    });
}
export async function revoke(req: Request, res: Response) {
  await DeviceToken.updateOne(
    {
      tokenHash: sha256(req.body.token),
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
    },
    { $set: { revokedAt: new Date() } },
  );
  res.status(204).send();
}

export async function status(req: Request, res: Response) {
  const activeDevices = await DeviceToken.countDocuments({
    userId: req.auth!.userId,
    sessionId: req.auth!.sessionId,
    revokedAt: null,
    permission: "GRANTED",
  });
  res.json({
    success: true,
    data: {
      configured: pushConfigured(),
      registered: activeDevices > 0,
      activeDevices,
    },
  });
}
