import { MemberProfile } from "../models/Member.js";

// Pending invitations disclose only the contact details entered by this gym.
// An owner cannot discover an existing account's global identity through receipts.
export async function redactPendingAccountRows(rows: any[], gymId: string | undefined, field: "userId" | "payerId") {
  if (!gymId || !rows.length) return rows;
  const userIds = rows.map(row => row[field]?._id || row[field]).filter(Boolean);
  const pending = await MemberProfile.find({ gymId, userId: { $in: userIds }, "invitation.status": "PENDING" }).select("userId contact.name").lean();
  const names = new Map(pending.map(member => [String(member.userId), member.contact?.name || "Pending invitation"]));
  return rows.map(row => {
    const id = row[field]?._id || row[field];
    return names.has(String(id)) ? { ...row, [field]: { _id: id, name: names.get(String(id)), status: "PENDING_VERIFICATION" } } : row;
  });
}
