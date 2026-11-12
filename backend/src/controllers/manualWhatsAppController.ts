import type { Request, Response } from "express";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { messagingGym, messagingGymDetails, whatsappGroupInput } from "../services/manualWhatsAppService.js";

export async function getWhatsAppGroup(req: Request, res: Response) {
  const gym = await messagingGym(req.auth!);
  res.json({ success: true, data: messagingGymDetails(gym).group });
}

export async function updateWhatsAppGroup(req: Request, res: Response) {
  const group = whatsappGroupInput.parse(req.body);
  await messagingGym(req.auth!);
  const result = await Gym.updateOne(
    { _id: req.auth!.gymId, ownerId: req.auth!.userId, deletedAt: null },
    { $set: { whatsappGroup: group } }, { runValidators: true },
  );
  if (!result.matchedCount) throw new AppError(403, "GYM_ACCESS_DENIED", "You cannot update this gym.");
  res.json({ success: true, data: group });
}
