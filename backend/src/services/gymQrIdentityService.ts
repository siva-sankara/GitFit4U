import { nanoid } from "nanoid";
import { GymScanner } from "../models/Attendance.js";
import { issueGymQr, permanentGymQr } from "./attendanceQrService.js";
import { isDuplicateKey } from "../utils/accountIdentity.js";
import { AppError } from "../utils/AppError.js";

export async function permanentGymIdentity(gymId: string) {
  const filter = { gymId, kind: "GYM_IDENTITY" };
  const publicId = nanoid(24);
  let identity;
  try {
    identity = await GymScanner.findOneAndUpdate(filter, { $setOnInsert: {
      publicId, qrPayload: permanentGymQr(publicId), name: "Gym attendance identity", secretVersion: 1, status: "ACTIVE",
    } }, { upsert: true, returnDocument: "after" });
  } catch (error) {
    // Separate unique publicId and (gymId, kind) indexes arbitrate competing
    // initializations. Return the committed winner, never a second reference.
    if (!isDuplicateKey(error)) throw error;
    identity = await GymScanner.findOne(filter);
    if (!identity) throw error;
  }
  if (identity.qrPayload) return identity;
  // Preserve the exact existing v2 encoding where reconstructable using the
  // current secret. Older printed signatures remain compatible via DB lookup.
  const payload = issueGymQr(gymId, identity.publicId, identity.secretVersion || 1);
  const filled = await GymScanner.findOneAndUpdate(
    { _id: identity._id, qrPayload: { $exists: false } },
    { $set: { qrPayload: payload } },
    { returnDocument: "after", overwriteImmutable: true },
  );
  const saved = filled || await GymScanner.findOne(filter);
  if (!saved?.qrPayload) throw new AppError(409, "QR_UNAVAILABLE", "The saved gym QR requires support review.");
  return saved;
}
