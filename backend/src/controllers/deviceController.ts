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
        token: req.body.token,
        platform: req.body.platform,
        permission: "GRANTED",
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    },
    { upsert: true, new: true, runValidators: true },
  ).select("-token");
  res.status(201).json({ success: true, data });
}
export async function revoke(req: Request, res: Response) {
  await DeviceToken.updateOne(
    { tokenHash: sha256(req.body.token), userId: req.auth!.userId },
    { $set: { revokedAt: new Date() } },
  );
  res.status(204).send();
}

export async function status(_req: Request, res: Response) {
  res.json({ success: true, data: { configured: pushConfigured() } });
}
