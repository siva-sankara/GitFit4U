import type { ClientSession, Types } from "mongoose";
import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { AppError } from "../utils/AppError.js";

// Exact names and locale of the approved Meta Utility templates.
export const membershipWhatsAppTemplates = {
  "membership.activated": { scope: "GYM", template: "welcome_msg_template", language: "en_US", bodyParameters: 6 },
  "membership.renewal_reminder": { scope: "GYM", template: "appointment_reminder", language: "en_US", bodyParameters: 4 },
  "membership.expiring": { scope: "GYM", template: "appointment_reminder", language: "en_US", bodyParameters: 4 },
  "platform.expiring": { scope: "PLATFORM", template: "platform_renewal", language: "en_US", bodyParameters: 4 },
} as const;

export type MembershipWhatsAppEvent = keyof typeof membershipWhatsAppTemplates;
export function membershipWhatsAppTemplate(event: string) {
  return membershipWhatsAppTemplates[event as MembershipWhatsAppEvent];
}

function invalidData() {
  return new AppError(409, "WHATSAPP_TEMPLATE_DATA_INVALID", "The membership template requires valid name, plan, dates, contact and INR amount data.");
}

function textValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw invalidData();
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > 1024) throw invalidData();
  return text;
}

export function membershipWhatsAppDate(value: Date | string, timezone = "Asia/Kolkata") {
  if (!value) throw invalidData();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw invalidData();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(date);
  return ["day", "month", "year"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

function renewalAmount(plan: any, currency: string) {
  if (currency !== "INR") throw invalidData();
  let minor = plan?.totalMinor;
  if (minor == null) {
    const price = plan?.priceMinor;
    const discount = plan?.discountMinor ?? 0;
    const tax = plan?.taxRateBasisPoints ?? 0;
    if (![price, discount, tax].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw invalidData();
    const subtotal = Math.max(0, price - discount);
    minor = subtotal + Math.round(subtotal * tax / 10_000);
  }
  if (!Number.isSafeInteger(minor) || minor < 0) throw invalidData();
  // The approved body already contains ₹; values are stored in paise.
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

export function buildMembershipWhatsAppComponents(
  event: MembershipWhatsAppEvent,
  user: { name?: string },
  gym: any,
  subscription: any,
) {
  const name = textValue(user.name);
  const plan = subscription.planSnapshot;
  const timezone = gym.timezone || "Asia/Kolkata";
  const expiry = membershipWhatsAppDate(subscription.endsAt, timezone);
  const values = event === "membership.activated"
    ? [name, textValue(gym.name), textValue(plan?.name),
        membershipWhatsAppDate(subscription.startsAt, timezone), expiry,
        textValue(gym.contact?.phone || gym.contact?.whatsapp)]
    : [name, textValue(event === "platform.expiring" ? plan?.name : gym.name), expiry,
        renewalAmount(plan, plan?.currency || gym.currency || "INR")];
  return [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }];
}

/** Static footers/URL buttons are rendered by Meta and need no send parameters. */
export function membershipTemplateMatches(components: unknown, parameterCount: number) {
  if (!Array.isArray(components)) return false;
  const bodies = components.filter((component) => component?.type === "BODY");
  if (bodies.length !== 1 || typeof bodies[0].text !== "string") return false;
  const variables = [...bodies[0].text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  const expected = Array.from({ length: parameterCount }, (_, index) => String(index + 1));
  if (new Set(variables).size !== parameterCount || variables.some((variable) => !expected.includes(variable)))
    return false;
  return components.every((component) => {
    if (component.type === "BODY") return true;
    if (component.type === "HEADER" && component.format !== "TEXT") return false;
    // Dynamic headers, buttons and media require a different approved contract.
    return ["HEADER", "FOOTER", "BUTTONS"].includes(component.type) &&
      !JSON.stringify(component).includes("{{");
  });
}

type MembershipEventInput = {
  event: string;
  userId: string | Types.ObjectId;
  gymId?: string | Types.ObjectId;
  entityId: string;
  subscriptionId?: string;
  session?: ClientSession;
};

async function membershipContext(input: MembershipEventInput, now: Date) {
  const template = membershipWhatsAppTemplate(input.event);
  if (!template || !input.gymId) return null;
  const subscription = await Subscription.findOne({
    publicId: input.subscriptionId || input.entityId,
    gymId: input.gymId,
    userId: input.userId,
    type: template.scope === "PLATFORM" ? "PLATFORM" : "GYM_MEMBERSHIP",
    status: { $in: input.event === "membership.activated" ? ["ACTIVE"] : ["ACTIVE", "GRACE"] },
  }).session(input.session || null).lean();
  // All three approved messages describe an active, unexpired subscription.
  if (!subscription?.endsAt || new Date(subscription.endsAt) <= now) return null;
  const gym = await Gym.findOne({
    _id: input.gymId,
    deletedAt: null,
    status: template.scope === "PLATFORM" ? { $in: ["ACTIVE", "INACTIVE"] } : "ACTIVE",
  }).select("name contact timezone currency").session(input.session || null).lean();
  if (!gym) return null;
  if (template.scope === "GYM") {
    if (!subscription.memberProfileId || !(await MemberProfile.exists({
      _id: subscription.memberProfileId,
      gymId: input.gymId,
      userId: input.userId,
      currentSubscriptionId: subscription._id,
      status: "ACTIVE",
    }).session(input.session || null))) return null;
  } else if (await Subscription.exists({
    gymId: input.gymId,
    type: "PLATFORM",
    status: { $in: ["ACTIVE", "GRACE"] },
    endsAt: { $gt: subscription.endsAt },
  }).session(input.session || null)) return null;
  return { gym, subscription };
}

export async function resolveMembershipWhatsAppTemplate(input: MembershipEventInput, user: { name?: string }, now = new Date()) {
  const context = await membershipContext(input, now);
  if (!context) return null;
  const { gym, subscription } = context;
  const endsAt = new Date(subscription.endsAt);
  return {
    parameters: buildMembershipWhatsAppComponents(input.event as MembershipWhatsAppEvent, user, gym, subscription),
    membershipContext: { subscriptionId: subscription.publicId, endsAt },
    expiresAt: new Date(Math.min(now.getTime() + 48 * 60 * 60_000, endsAt.getTime())),
  };
}

export async function membershipWhatsAppStillCurrent(outbox: any, now = new Date()) {
  if (!outbox.membershipContext?.subscriptionId) return false;
  const current = await membershipContext({
    event: outbox.businessEvent,
    userId: outbox.recipientUserId,
    gymId: outbox.gymId,
    entityId: outbox.membershipContext.subscriptionId,
  }, now);
  return Boolean(current && new Date(current.subscription.endsAt).getTime() ===
    new Date(outbox.membershipContext.endsAt).getTime());
}
