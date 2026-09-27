import { Router } from "express";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import {
  requireAuth,
  requireGymContext,
  requirePermission,
  requireRole,
} from "../middleware/auth.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";

export const gymTermsInput = z
  .object({
    text: z
      .string()
      .max(20000)
      .transform((value) =>
        [...value.replaceAll("\r\n", "\n")]
          .filter((character) => {
            const code = character.charCodeAt(0);
            return (
              code === 9 ||
              code === 10 ||
              code === 13 ||
              (code >= 32 && code !== 127)
            );
          })
          .join("")
          .trim(),
      ),
  })
  .strict();
export const gymTermsRoutes = Router();
gymTermsRoutes.use(
  requireAuth,
  requireRole("GYM_OWNER", "GYM_STAFF"),
  requireGymContext,
  requirePermission("gym:update"),
);
gymTermsRoutes.patch("/", async (req, res) => {
  const { text } = gymTermsInput.parse(req.body);
  const terms = { text, updatedAt: new Date(), updatedBy: req.auth!.userId };
  const gym = await Gym.findOneAndUpdate(
    { _id: req.auth!.gymId, deletedAt: null },
    { $set: { terms } },
    { returnDocument: "after", runValidators: true },
  );
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  await writeAudit(req, {
    action: "gym.terms.updated",
    entityType: "Gym",
    entityId: gym.publicId,
  });
  res.json({
    success: true,
    data: { text: gym.terms.text, updatedAt: gym.terms.updatedAt },
  });
});
