import type { ClientSession } from "mongoose";
import { Attachment } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";

// A read alone does not serialize reference creation against media deletion.
// Both operations must write the attachment inside their entity transaction.
export async function lockAttachments(ids: unknown[], session: ClientSession) {
  const unique = [...new Set(ids.filter(Boolean).map(String))].sort();
  if (!unique.length) return;
  if (!session.inTransaction())
    throw new Error("Media binding requires an active database transaction.");
  const result = await Attachment.updateMany(
    { _id: { $in: unique }, status: "READY", deletedAt: null },
    { $inc: { bindingVersion: 1 } },
    { session },
  );
  if (result.matchedCount !== unique.length)
    throw new AppError(
      409,
      "MEDIA_UNAVAILABLE",
      "An image changed while saving. Refresh and choose an available upload.",
    );
}
