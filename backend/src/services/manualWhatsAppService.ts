import type { Request } from "express";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { AppError } from "../utils/AppError.js";
import { manualWhatsAppChatUrl } from "../utils/whatsappDeepLink.js";
import { privatePendingMember } from "./memberInvitationPrivacy.js";

export const whatsappGroupInput = z.object({
  name: z.string().trim().max(100),
  inviteLink: z.string().trim().max(300).refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "chat.whatsapp.com" &&
        !url.username && !url.password && !url.port && !url.search && !url.hash &&
        /^\/[A-Za-z0-9_-]{10,128}$/.test(url.pathname);
    } catch { return false; }
  }, "Enter a valid https://chat.whatsapp.com/ group invite link."),
}).strict().refine(value => Boolean(value.name) === Boolean(value.inviteLink), {
  message: "Enter both the group name and invite link, or clear both to remove the group.",
});

export async function messagingGym(auth: NonNullable<Request["auth"]>) {
  if (auth.role !== "GYM_OWNER" || !auth.gymId)
    throw new AppError(403, "OWNER_REQUIRED", "Only gym owners can use manual WhatsApp messaging.");
  const gym = await Gym.findOne({ _id: auth.gymId, ownerId: auth.userId, deletedAt: null })
    .select("publicId name timezone ownerId +whatsappGroup")
    .populate("ownerId", "name").lean();
  if (!gym) throw new AppError(403, "GYM_ACCESS_DENIED", "You cannot access this gym's messaging settings.");
  return gym;
}

export function messagingGymDetails(gym: any) {
  return {
    gymName: gym.name,
    ownerName: gym.ownerId?.name || "",
    group: { name: gym.whatsappGroup?.name || "", inviteLink: gym.whatsappGroup?.inviteLink || "" },
  };
}

// Receives the existing member-list filters, never client-supplied phone numbers.
export async function messagingMembers(gymId: string, filter: Record<string, unknown>, sort: Record<string, 1 | -1>, skip: number, limit: number) {
  const members = await MemberProfile.find({ ...filter, gymId, isDeleted: { $ne: true } })
    .select("publicId status directAccess contact.name contact.phone userId invitation.status currentSubscriptionId")
    .populate("userId", "name phone")
    .populate({ path: "currentSubscriptionId", match: { gymId, type: "GYM_MEMBERSHIP" }, select: "status startsAt endsAt planSnapshot.name" })
    .sort(sort).skip(skip).limit(limit).lean();
  return members.map((raw: any) => {
    const member = privatePendingMember(raw);
    const name = member.contact?.name || member.userId?.name || "Member";
    const phone = member.contact?.phone || member.userId?.phone || "";
    const subscription = member.currentSubscriptionId;
    return {
      publicId: member.publicId, name, phone,
      status: member.status, directAccess: Boolean(member.directAccess),
      chatUrl: manualWhatsAppChatUrl(phone),
      currentSubscriptionId: subscription ? {
        status: subscription.status, startsAt: subscription.startsAt, endsAt: subscription.endsAt,
        planSnapshot: { name: subscription.planSnapshot?.name },
      } : null,
      // Historical payments / plan snapshots are not authoritative renewal quotes.
      renewalAmount: null,
    };
  });
}
