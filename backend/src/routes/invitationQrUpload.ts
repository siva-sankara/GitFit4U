import multer from "multer";
import rateLimit from "express-rate-limit";
export const invitationQrUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5_000_000, files: 1, fields: 0 } }).single("qr");
export const invitationQrLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
