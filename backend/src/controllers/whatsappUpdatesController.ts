import type { Request, Response } from "express";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { emptyWhatsAppUpdates, membershipWhatsAppUpdates, ownerUpdatesScope, whatsappUpdatesInput, ownersInvitationKey, platformOwnersInvitation } from "../services/whatsappUpdatesService.js";
import { PlatformSettings } from "../models/Operations.js";
import { invitationPresentation, storeInvitationQr, verifiedInvitationQr } from "../services/invitationQrService.js";
import { writeAudit } from "../services/auditService.js";
import { parseWhatsAppInvite } from "../utils/whatsappInvite.js";

export async function getWhatsAppUpdates(req: Request, res: Response) {
  const gym = await Gym.findOne(ownerUpdatesScope(req.auth!)).select("+whatsappUpdates +whatsappGroup").lean();
  if (!gym) throw new AppError(403, "GYM_ACCESS_DENIED", "You cannot access this gym.");
  const legacy = !gym.whatsappUpdates && gym.whatsappGroup?.inviteLink ? { ...emptyWhatsAppUpdates, displayName: gym.whatsappGroup.name, inviteUrl: gym.whatsappGroup.inviteLink } : null;
  res.set("Cache-Control", "private, no-store").json({ success: true, data: await invitationPresentation(gym.whatsappUpdates || legacy) || emptyWhatsAppUpdates });
}
export async function updateWhatsAppUpdates(req: Request, res: Response) {
  const scope = ownerUpdatesScope(req.auth!);
  const input = whatsappUpdatesInput.parse(req.body);
  const previous = await Gym.findOne(scope).select("+whatsappUpdates").lean();
  if (!previous) throw new AppError(403, "GYM_ACCESS_DENIED", "You cannot update this gym.");
  const changed = parseWhatsAppInvite(previous.whatsappUpdates?.inviteUrl || "").url !== input.inviteUrl;
  const qrId = input.qrId === undefined ? changed ? null : previous.whatsappUpdates?.qrId || null : input.qrId;
  if (qrId) await verifiedInvitationQr(qrId, input.inviteUrl, { scope: "GYM_MEMBERS", gymId: req.auth!.gymId, ownerId: req.auth!.userId });
  input.qrId = qrId;
  const fields = Object.fromEntries(Object.entries(input).map(([key, value]) => [`whatsappUpdates.${key}`, value]));
  // Actor/time and monotonically increasing configuration version commit with the change.
  const gym = await Gym.findOneAndUpdate({ ...scope, "whatsappUpdates.version": previous.whatsappUpdates?.version ?? { $exists: false } }, {
    $set: { ...fields, "whatsappUpdates.updatedAt": new Date(), "whatsappUpdates.updatedBy": req.auth!.userId },
    $inc: { "whatsappUpdates.version": 1 },
  }, { returnDocument: "after", runValidators: true }).select("+whatsappUpdates").lean();
  if (!gym) throw new AppError(409, "INVITATION_CHANGED", "The invitation changed while you were editing. Reload before saving.");
  await writeAudit(req, { action: "gym.whatsapp-invitation.updated", entityType: "Gym", entityId: String(gym._id) });
  res.set("Cache-Control", "private, no-store").json({ success: true, data: await invitationPresentation(gym.whatsappUpdates) });
}

export async function platformInvitationSettings(req: Request, res: Response) {
  if (req.auth!.role !== "ADMIN") throw new AppError(403, "ADMIN_REQUIRED", "Administrator access required.");
  let record = await PlatformSettings.findOne({ key: ownersInvitationKey }).lean();
  if (req.method === "PATCH") {
    const input = whatsappUpdatesInput.parse(req.body);
    const changed = parseWhatsAppInvite(record?.values?.inviteUrl || "").url !== input.inviteUrl;
    input.qrId = input.qrId === undefined ? changed ? null : record?.values?.qrId || null : input.qrId;
    if (input.qrId) await verifiedInvitationQr(input.qrId, input.inviteUrl, { scope: "PLATFORM_OWNERS", ownerId: req.auth!.userId });
    record = await PlatformSettings.findOneAndUpdate({ key: ownersInvitationKey, ...(record ? { "values.version": record.values.version } : {}) }, { $set: { values: { ...input, version: (record?.values?.version || 0) + 1 }, updatedBy: req.auth!.userId } }, { upsert: !record, returnDocument: "after" }).lean();
    if (!record) throw new AppError(409, "INVITATION_CHANGED", "Settings changed. Reload before saving.");
    await writeAudit(req, { action: "platform.whatsapp-invitation.updated", entityType: "PlatformSettings", entityId: ownersInvitationKey });
  }
  res.set("Cache-Control", "private, no-store").json({ success: true, data: await invitationPresentation(record?.values) || emptyWhatsAppUpdates });
}
export async function uploadInvitationQr(req: Request, res: Response) {
  if (!req.file) throw new AppError(422, "INVITE_QR_FILE", "Choose a PNG, JPG or WebP QR image.");
  const platform = req.auth!.role === "ADMIN";
  let previous;
  if (platform) previous = (await PlatformSettings.findOne({ key: ownersInvitationKey }).lean())?.values;
  else {
    const gym = await Gym.findOne(ownerUpdatesScope(req.auth!)).select("+whatsappUpdates").lean();
    if (!gym) throw new AppError(403, "GYM_ACCESS_DENIED", "You cannot update this gym.");
    previous = gym.whatsappUpdates;
  }
  const data = await storeInvitationQr(req.file.buffer, req.file.mimetype, { scope: platform ? "PLATFORM_OWNERS" : "GYM_MEMBERS", ...(platform ? {} : { gymId: req.auth!.gymId }), ownerId: req.auth!.userId }, previous?.inviteUrl);
  await writeAudit(req, { action: "whatsapp-invitation.qr.uploaded", entityType: "InvitationQr", entityId: data.qrId });
  res.set("Cache-Control", "private, no-store").status(201).json({ success: true, data });
}
export async function getOwnersInvitation(req: Request, res: Response) {
  if (req.auth!.role !== "GYM_OWNER") throw new AppError(403, "OWNER_REQUIRED", "Owner access required.");
  const data = await platformOwnersInvitation(req.auth!.userId, req.auth!.gymId!);
  res.set("Cache-Control", "private, no-store").json({ success: true, data });
}
export async function getMembershipWhatsAppUpdates(req: Request, res: Response) {
  const data = await membershipWhatsAppUpdates(req.auth!.userId, String(req.params.id));
  res.set("Cache-Control", "private, no-store").json({ success: true, data });
}
