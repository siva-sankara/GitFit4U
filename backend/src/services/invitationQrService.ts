import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { validateMediaBytes } from "./mediaValidation.js";
import { parseWhatsAppInvite } from "../utils/whatsappInvite.js";
import { AppError } from "../utils/AppError.js";
import { putS3Bytes, deleteMedia } from "../integrations/storage/mediaStore.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";

const schema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true },
  scope: { type: String, enum: ["GYM_MEMBERS", "PLATFORM_OWNERS"], required: true },
  gymId: { type: mongoose.Schema.Types.ObjectId }, ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  objectKey: { type: String, required: true, select: false }, inviteUrl: { type: String, required: true, select: false },
}, { timestamps: true });
export const InvitationQr = mongoose.models.InvitationQr || mongoose.model("InvitationQr", schema);
let prepared = false;
export async function decodeInvitationQr(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > 5_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(mime))
    throw new AppError(422, "INVITE_QR_FILE", "Choose a PNG, JPG or WebP image no larger than 5 MB.");
  validateMediaBytes(bytes, mime);
  let png: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width > 6000 || meta.height > 6000 || (meta.pages || 1) > 1) throw new Error("dimensions");
    // Strip metadata and retain every pixel; no crop, resizing, overlays or inversion.
    png = await image.rotate().png().toBuffer();
  } catch { throw new AppError(422, "INVITE_QR_IMAGE", "Choose a valid still image up to 16 megapixels and 6,000 pixels per side."); }
  if (!prepared) {
    prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm")) } });
    prepared = true;
  }
  const codes = await readBarcodes(png, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 16 });
  if (codes.length !== 1 || !codes[0].isValid)
    throw new AppError(422, "INVITE_QR_AMBIGUOUS", codes.length > 1 ? "Multiple QR codes found. Upload an image containing only the invitation QR." : "No clear QR code found. Upload the original image or a clearer screenshot.");
  const parsed = parseWhatsAppInvite(codes[0].text);
  if (parsed.error) throw new AppError(422, "INVITE_QR_LINK", parsed.error);
  return { png, ...parsed };
}
export type QrScope = { scope: "GYM_MEMBERS" | "PLATFORM_OWNERS"; gymId?: unknown; ownerId: string };
export async function storeInvitationQr(bytes: Buffer, mime: string, scope: QrScope, expectedLink?: string) {
  const decoded = await decodeInvitationQr(bytes, mime);
  if (expectedLink && parseWhatsAppInvite(expectedLink).url !== decoded.url)
    throw new AppError(422, "INVITE_QR_MISMATCH", "This QR does not match the saved invitation. Save the intended invitation first, then upload its QR.");
  const publicId = nanoid(24);
  const objectKey = `private/whatsapp-invitations/${scope.scope}/${scope.gymId || "platform"}/${publicId}.png`;
  const file = { objectKey, storageProvider: "s3", mimeType: "image/png" };
  await putS3Bytes(file, decoded.png);
  try { await InvitationQr.create({ ...scope, publicId, objectKey, inviteUrl: decoded.url }); }
  catch (error) { await deleteMedia(file).catch(() => undefined); throw error; }
  return { qrId: publicId, qrUrl: presignedObjectUrl("GET", objectKey, 120), inviteUrl: decoded.url, type: decoded.type };
}
export async function verifiedInvitationQr(qrId: string, inviteUrl: string, scope: QrScope) {
  const qr = await InvitationQr.findOne({ publicId: qrId, scope: scope.scope, ...(scope.scope === "GYM_MEMBERS" ? { gymId: scope.gymId, ownerId: scope.ownerId } : {}) }).select("+objectKey +inviteUrl").lean();
  if (!qr || qr.inviteUrl !== inviteUrl) throw new AppError(422, "INVITE_QR_MISMATCH", "The QR must contain exactly this invitation and belong to this settings scope. Replace it or confirm its detected link first.");
  return qr;
}
export async function invitationPresentation(link: any, gymName?: string) {
  if (!link) return null;
  const parsed = parseWhatsAppInvite(link.inviteUrl || "", link.type);
  let qrUrl: string | undefined;
  if (!parsed.error && link.qrId) {
    const qr = await InvitationQr.findOne({ publicId: link.qrId, inviteUrl: parsed.url }).select("+objectKey").lean();
    if (qr) qrUrl = presignedObjectUrl("GET", qr.objectKey, 120);
  }
  return { enabled: Boolean(link.enabled), type: link.type, displayName: link.displayName || "", inviteUrl: parsed.url || "", description: link.description || "", version: link.version || 0, qrId: link.qrId || null, qrUrl, gymName };
}
