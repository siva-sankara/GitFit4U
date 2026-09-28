import { profileUpdateInput } from "../routes/profileSchemas.js";

// Missing fields are untouched; explicit null removes only a schema-authorized field.
// Never replace an entire profile/preferences object or spread unvalidated input.
export function profileUpdateOperation(input: unknown) {
  const body = profileUpdateInput.parse(input);
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.avatarAttachmentId !== undefined) {
    if (body.avatarAttachmentId === null) unset.avatarAttachmentId = 1;
    else set.avatarAttachmentId = body.avatarAttachmentId;
    unset.avatarUrl = 1;
  }
  for (const group of [
    "profile",
    "preferences",
    "notificationPreferences",
    "social",
  ] as const) {
    for (const [key, value] of Object.entries(body[group] || {})) {
      if (value === undefined) continue;
      if (value === null) unset[`${group}.${key}`] = 1;
      else set[`${group}.${key}`] = value;
    }
  }
  return {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
    $inc: { version: 1 },
  };
}
