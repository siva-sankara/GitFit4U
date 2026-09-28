type ScannerRow = { _id: unknown; gymId?: unknown; publicId?: unknown; kind?: string; qrPayload?: unknown; secretVersion?: unknown };
function validStoredPayload(row: ScannerRow) {
  if (row.qrPayload === undefined) return true;
  if (typeof row.qrPayload !== "string" || row.qrPayload.length > 2048) return false;
  if (row.qrPayload === `getfit4u:gym:${row.publicId}` && /^[A-Za-z0-9_-]{24}$/.test(String(row.publicId))) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(row.qrPayload)) return false;
  try {
    const value = JSON.parse(Buffer.from(row.qrPayload.split(".")[0], "base64url").toString("utf8"));
    return value?.v === 2 && value.purpose === "GYM_ATTENDANCE" && value.gymId === String(row.gymId) &&
      value.identityId === row.publicId && value.revision === (row.secretVersion || 1);
  } catch { return false; }
}
export function inspectGymQrIdentities(scanners: ScannerRow[], gymIds: unknown[]) {
  const gyms = new Set(gymIds.map(String));
  const identities = scanners.filter((row) => row.kind === "GYM_IDENTITY");
  const duplicates = (rows: ScannerRow[], key: (row: ScannerRow) => unknown) => {
    const grouped = new Map<string, string[]>();
    for (const row of rows) { const value = key(row); if (value === undefined) continue;
      const ids = grouped.get(String(value)) || []; ids.push(String(row._id)); grouped.set(String(value), ids); }
    return [...grouped.values()].filter((ids) => ids.length > 1);
  };
  const duplicateGymIdentities = duplicates(identities, (row) => row.gymId);
  const duplicatePublicReferences = duplicates(scanners, (row) => row.publicId);
  const duplicatePayloads = duplicates(scanners, (row) => row.qrPayload);
  const invalidIdentities = identities.filter((row) => !gyms.has(String(row.gymId)) ||
    typeof row.publicId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(row.publicId) ||
    (row.secretVersion !== undefined && (!Number.isInteger(row.secretVersion) || Number(row.secretVersion) < 1)) ||
    !validStoredPayload(row)).map((row) => String(row._id));
  const existing = new Set(identities.map((row) => String(row.gymId)));
  return { gyms: gyms.size, identities: identities.length, savedPayloads: identities.filter((row) => typeof row.qrPayload === "string" && row.qrPayload).length,
    legacyPayloadsToSave: identities.filter((row) => row.qrPayload === undefined).length,
    gymsWithoutIdentity: [...gyms].filter((id) => !existing.has(id)).length,
    duplicateGymIdentities, duplicatePublicReferences, duplicatePayloads, invalidIdentities,
    safeToApply: ![duplicateGymIdentities, duplicatePublicReferences, duplicatePayloads, invalidIdentities].some((rows) => rows.length) };
}
