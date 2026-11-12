import { gymDate, membershipPresentation } from "../components/MembershipStatusDot";
import type { ApiEnvelope } from "./apiClient";

export interface WhatsAppMember {
  publicId: string;
  name: string;
  phone: string;
  chatUrl: string | null;
  status: string;
  directAccess: boolean;
  renewalAmount: string | null;
  currentSubscriptionId: { status: string; startsAt?: string; endsAt?: string; planSnapshot?: { name?: string } } | null;
}
export interface WhatsAppContext {
  gymName: string;
  ownerName: string;
  timezone: string;
  serverNow: string;
  group: { name: string; inviteLink: string };
}
export type MessagingEnvelope = ApiEnvelope<WhatsAppMember[]> & { meta: WhatsAppContext & { total: number; totalPages: number } };

export const messagePresets = {
  renewal: { label: "Renewal Reminder", text: "Hi {{memberName}},\n\nThis is a reminder from {{gymName}} that your gym membership will expire on {{expiryDate}}.\n\nPlease renew your membership to continue your gym access without interruption.\n\nThank you,\n{{gymName}}" },
  expiry: { label: "Expiry Reminder", text: "Hi {{memberName}},\n\nYour membership with {{gymName}} expires on {{expiryDate}}.\n\nPlease renew your membership to continue accessing the gym.\n\nThank you,\n{{gymName}}" },
  payment: { label: "Payment Reminder", text: "Hi {{memberName}},\n\nThis is a friendly reminder from {{gymName}} regarding your membership renewal.\n\nYour membership expires on {{expiryDate}}.\n\nPlease contact the gym or complete your renewal at your convenience.\n\nThank you,\n{{gymName}}" },
  welcome: { label: "Welcome Message", text: "Hi {{memberName}},\n\nWelcome to {{gymName}}! 💪\n\nWe are happy to have you with us.\n\nMembership Plan: {{planName}}\nExpiry Date: {{expiryDate}}\n\nSee you at the gym!\n\n{{gymName}}" },
  general: { label: "General Message", text: "Hi {{memberName}},\n\nA quick update from {{gymName}}:\n\n" },
  custom: { label: "Custom Message", text: "" },
  group: { label: "Group Invite", text: "Hi {{memberName}},\n\nWelcome to {{gymName}}.\n\nJoin our official WhatsApp member group for gym updates, classes and announcements:\n\n{{groupInviteLink}}\n\nThank you,\n{{gymName}}" },
} as const;
export type MessageType = keyof typeof messagePresets;
export const messageVariables = {
  memberName: "Member Name", gymName: "Gym Name", planName: "Plan", expiryDate: "Expiry Date",
  renewalAmount: "Renewal Amount", daysRemaining: "Days Remaining", ownerName: "Owner Name", groupInviteLink: "Group Invite Link",
} as const;

export function renderWhatsAppMessage(template: string, context: WhatsAppContext, member?: WhatsAppMember) {
  const view = member ? membershipPresentation(member, context.timezone, new Date(context.serverNow)) : null;
  const expiry = member?.currentSubscriptionId?.endsAt;
  const values: Record<string, string | number | null | undefined> = {
    gymName: context.gymName, ownerName: context.ownerName, groupInviteLink: context.group.inviteLink,
    memberName: member?.name, planName: member?.currentSubscriptionId?.planSnapshot?.name,
    expiryDate: expiry && Number.isFinite(Date.parse(expiry)) ? gymDate(expiry, context.timezone) : undefined,
    daysRemaining: view?.daysRemaining, renewalAmount: member?.renewalAmount,
  };
  const issues = new Set<string>();
  const text = template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) { issues.add(`Unsupported variable: ${key}.`); return ""; }
    const value = values[key];
    if (value === null || value === undefined || value === "") {
      issues.add(`${messageVariables[key as keyof typeof messageVariables]} is unavailable${member ? ` for ${member.name}` : " in a generic message"}.`);
      return "";
    }
    return String(value);
  }).trim();
  if (/{{|}}/.test(text)) issues.add("Remove unfinished or unresolved message variables.");
  if (!text) issues.add("Enter a message before opening WhatsApp.");
  if (text.length > 4000) issues.add("Keep the personalized message within 4,000 characters.");
  return { text, issues: [...issues] };
}

export function recipientMessage(member: WhatsAppMember, template: string, context: WhatsAppContext) {
  const result = renderWhatsAppMessage(template, context, member);
  if (!member.chatUrl || !/^https:\/\/wa\.me\/[1-9]\d{7,14}$/.test(member.chatUrl))
    result.issues.unshift(`${member.name} does not have a valid mobile number.`);
  return result;
}

export interface WhatsAppMessagingProvider {
  openChat(chatUrl: string, message?: string): void;
  openShare(message: string): void;
}
function encodedMessage(message: string) {
  if (!message.trim() || message.length > 4000 || /{{|}}/.test(message)) throw new Error("Review the message before opening WhatsApp.");
  return encodeURIComponent(message);
}
export const whatsAppDeepLinkProvider: WhatsAppMessagingProvider = {
  openChat(chatUrl, message) {
    // The server prepares this base URL using the shared phone normalizer.
    if (!/^https:\/\/wa\.me\/[1-9]\d{7,14}$/.test(chatUrl)) throw new Error("A valid mobile number is required.");
    const url = message === undefined ? chatUrl : `${chatUrl}?text=${encodedMessage(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  },
  openShare(message) {
    window.open(`https://wa.me/?text=${encodedMessage(message)}`, "_blank", "noopener,noreferrer");
  },
};

export interface RecipientProgress {
  member: WhatsAppMember;
  text: string;
  issues: string[];
  status: "PENDING" | "OPENED_WHATSAPP" | "PROCESSED_BY_OWNER" | "SKIPPED";
}
export function prepareRecipients(members: WhatsAppMember[], template: string, context: WhatsAppContext): RecipientProgress[] {
  return [...new Map(members.map(member => [member.publicId, member])).values()].map(member => {
    const result = recipientMessage(member, template, context);
    return { member, ...result, status: result.issues.length ? "SKIPPED" : "PENDING" };
  });
}
