import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({ env: {
  NODE_ENV: "test", LOG_LEVEL: "silent", WHATSAPP_MODE: "live",
  WHATSAPP_DEFAULT_LANGUAGE: "en_GB", WHATSAPP_API_VERSION: "v26.0",
} }));

import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { MemberCommunication } from "../models/Communication.js";
import { WhatsAppConnection, WhatsAppConsent, WhatsAppConversation, WhatsAppMessage, WhatsAppOutbox, WhatsAppTemplate } from "../models/WhatsApp.js";
import * as connections from "./whatsappConnectionService.js";
import { enqueueWhatsAppDomainEvent, evaluateWhatsAppDeliveryPolicy, processWhatsAppOutbox, whatsappEventMatrix } from "./whatsappDeliveryService.js";
import { buildMembershipWhatsAppComponents, membershipTemplateMatches, membershipWhatsAppStillCurrent } from "./whatsappMembershipTemplateService.js";

// The approved bodies supplied by the business; static footer/button need no values.
const bodies = {
  welcome_msg_template: "Hi {{1}},\nWelcome to {{2}}! 🎉\nYour membership has been successfully activated. We’re happy to have you with us and look forward to supporting you on your fitness journey.\nMembership Plan: {{3}}\nStart Date: {{4}}\nExpiry Date: {{5}}\nIf you need any assistance, feel free to contact us {{6}}\nSee you at the gym! 💪",
  appointment_reminder: "Hi {{1}},\nThis is a reminder from {{2}} that your gym membership will expire on {{3}}.\nPlease renew your membership to continue accessing the gym without interruption.\nMembership amount: ₹{{4}}\nThank you.",
  platform_renewal: "Hi {{1}},\nThis is a reminder from GETFIT4U that the platform subscription for {{2}} will expire on {{3}}.\nRenewal Amount: ₹{{4}}\nPlease renew your subscription before the expiry date to continue using GETFIT4U services without interruption.\nThank you,\nGETFIT4U Team",
};
const approved = (name: keyof typeof bodies) => ({
  name, language: "en_US", category: "UTILITY", status: "APPROVED",
  components: [{ type: "BODY", text: bodies[name] }, ...(name === "appointment_reminder"
    ? [{ type: "BUTTONS", buttons: [{ type: "URL", text: "Visit website", url: "https://getfit4u.example" }] }]
    : name === "welcome_msg_template" ? [{ type: "FOOTER", text: "Great Day ahead" }] : [])],
});
function query(value: any): any {
  const result: any = Promise.resolve(value);
  for (const method of ["select", "session", "lean"]) result[method] = vi.fn(() => result);
  return result;
}
const now = new Date("2026-10-07T10:00:00Z");
const user = { _id: "user", name: "Rahul", phone: "9876543210" };
const event = { event: "membership.activated", userId: "user", gymId: "gym", entityId: "subscription-public" };
let gym: any, subscription: any, connection: any;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  gym = { name: "Gym one", timezone: "Asia/Kolkata", currency: "INR", contact: { phone: "7569950702" } };
  subscription = {
    _id: "subscription", publicId: "subscription-public", gymId: "gym", userId: "user",
    memberProfileId: "member", type: "GYM_MEMBERSHIP", status: "ACTIVE",
    startsAt: new Date("2026-10-06T18:30:00Z"), endsAt: new Date("2026-10-10T18:30:00Z"),
    planSnapshot: { name: "Elite Membership", priceMinor: 100000 },
  };
  connection = { _id: "connection", publicId: "sender", scope: "GYM", gymId: "gym", status: "CONNECTED", outboundPaused: false,
    phoneNumberId: "phone-number", limits: { quietHoursStart: "00:00", quietHoursEnd: "00:00" } };
  vi.spyOn(WhatsAppConnection, "findOne").mockImplementation(() => query(connection));
  vi.spyOn(WhatsAppTemplate, "findOne").mockImplementation((filter: any) => query(approved(filter.name)));
  vi.spyOn(Subscription, "findOne").mockImplementation(() => query(subscription));
  vi.spyOn(Subscription, "exists").mockImplementation(() => query(null));
  vi.spyOn(MemberProfile, "exists").mockImplementation(() => query({ _id: "member" }));
  vi.spyOn(Gym, "findOne").mockImplementation(() => query(gym));
  vi.spyOn(WhatsAppConsent, "findOne").mockImplementation(() => query({ service: { grantedAt: now } }));
  vi.spyOn(WhatsAppConversation, "findOneAndUpdate").mockResolvedValue({ _id: "conversation" } as never);
  vi.spyOn(WhatsAppConversation, "findById").mockImplementation(() => query({}));
  vi.spyOn(WhatsAppOutbox, "countDocuments").mockResolvedValue(0);
  const rows = new Map();
  vi.spyOn(WhatsAppOutbox, "findOneAndUpdate").mockImplementation(async (filter: any, update: any) => {
    if (!rows.has(filter.dedupeKey)) rows.set(filter.dedupeKey, { _id: "outbox", ...update.$setOnInsert });
    return rows.get(filter.dedupeKey);
  });
  let messageCreated = false;
  vi.spyOn(WhatsAppMessage, "exists").mockImplementation(async () => messageCreated ? { _id: "message" } : null);
  vi.spyOn(WhatsAppMessage, "create").mockImplementation(async () => { messageCreated = true; return [] as never; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("approved membership WhatsApp templates", () => {
  it("queues the six welcome values in approved order, with gym-local dates and a static footer", async () => {
    const row = await enqueueWhatsAppDomainEvent(event, user);
    expect(row.template).toEqual({ name: "welcome_msg_template", language: "en_US", parameters: [{ type: "body", parameters: [
      "Rahul", "Gym one", "Elite Membership", "07-10-2026", "11-10-2026", "7569950702",
    ].map((text) => ({ type: "text", text })) }] });
    expect(WhatsAppTemplate.findOne).toHaveBeenCalledWith(expect.objectContaining({ language: "en_US", category: "UTILITY", status: "APPROVED" }));
    expect(WhatsAppConnection.findOne).toHaveBeenCalledWith(expect.objectContaining({ bindingKey: "GYM:gym" }));
    expect(Subscription.findOne).toHaveBeenCalledWith(expect.objectContaining({ publicId: event.entityId, gymId: "gym", userId: "user", type: "GYM_MEMBERSHIP" }));
    expect(row.status).toBe("QUEUED");
  });

  it("deduplicates repeated activation and does not map creation to a second welcome", async () => {
    const first = await enqueueWhatsAppDomainEvent(event, user);
    const retry = await enqueueWhatsAppDomainEvent({ ...event, occurrenceId: "payment-activation-retry" }, user);
    expect(first).toBe(retry);
    expect(WhatsAppMessage.create).toHaveBeenCalledTimes(1);
    expect(whatsappEventMatrix["membership.created"].template).not.toBe("welcome_msg_template");
  });

  it("queues renewal values and leaves the static Visit website button to Meta", async () => {
    const row = await enqueueWhatsAppDomainEvent({ ...event, event: "membership.renewal_reminder", entityId: "member-public", subscriptionId: "subscription-public", occurrenceId: "manual-reminder" }, user);
    expect(row.template.name).toBe("appointment_reminder");
    expect(row.template.parameters).toEqual([{ type: "body", parameters: ["Rahul", "Gym one", "11-10-2026", "1000"].map((text) => ({ type: "text", text })) }]);
    expect(Subscription.findOne).toHaveBeenCalledWith(expect.objectContaining({ publicId: "subscription-public" }));
  });

  it("uses the platform sender and plan name for admin subscription reminders", async () => {
    subscription.type = "PLATFORM";
    subscription.planSnapshot = { name: "Elite platform", priceMinor: 200000 };
    connection.scope = "PLATFORM";
    const row = await enqueueWhatsAppDomainEvent({ ...event, event: "platform.expiring" }, user);
    expect(row.scope).toBe("PLATFORM");
    expect(row.template.name).toBe("platform_renewal");
    expect(row.template.parameters[0].parameters.map((value: any) => value.text)).toEqual(["Rahul", "Elite platform", "11-10-2026", "2000"]);
    expect(WhatsAppConnection.findOne).toHaveBeenCalledWith(expect.objectContaining({ bindingKey: "PLATFORM" }));
    expect(Subscription.findOne).toHaveBeenCalledWith(expect.objectContaining({ type: "PLATFORM", userId: "user", gymId: "gym" }));
    expect(MemberProfile.exists).not.toHaveBeenCalled();
  });

  it("uses the charged plan snapshot, preserves paise, and does not add a second rupee sign", () => {
    subscription.planSnapshot.totalMinor = 123456;
    const values = buildMembershipWhatsAppComponents("membership.renewal_reminder", user, gym, subscription)[0].parameters;
    expect(values[3].text).toBe("1234.56");
    subscription.planSnapshot = { priceMinor: 100000, discountMinor: 10000, taxRateBasisPoints: 1800 };
    expect(buildMembershipWhatsAppComponents("membership.renewal_reminder", user, gym, subscription)[0].parameters[3].text).toBe("1062");
    subscription.planSnapshot = { totalMinor: 0 };
    expect(buildMembershipWhatsAppComponents("membership.renewal_reminder", user, gym, subscription)[0].parameters[3].text).toBe("0");
  });

  it.each(["missing amount", "invalid amount", "non-INR", "missing date", "missing contact", "missing name"])("does not queue with %s", async (problem) => {
    let input = { ...event, event: "membership.renewal_reminder" };
    if (problem === "missing amount") subscription.planSnapshot = {};
    if (problem === "invalid amount") subscription.planSnapshot.priceMinor = -1;
    if (problem === "non-INR") gym.currency = "USD";
    if (problem === "missing date") subscription.endsAt = null;
    if (problem === "missing contact") { gym.contact = {}; input = event; }
    await enqueueWhatsAppDomainEvent(input, problem === "missing name" ? { ...user, name: "" } : user);
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("normalizes whitespace and supports the gym WhatsApp contact when phone is absent", () => {
    gym.contact = { whatsapp: "7569950702" };
    const values = buildMembershipWhatsAppComponents("membership.activated", { name: " Rahul\n\t Kumar " }, gym, subscription)[0].parameters;
    expect(values[0].text).toBe("Rahul Kumar");
    expect(values[5].text).toBe("7569950702");
  });

  it("rejects mismatched variables, dynamic buttons and media headers", () => {
    expect(membershipTemplateMatches(approved("welcome_msg_template").components, 6)).toBe(true);
    expect(membershipTemplateMatches(approved("welcome_msg_template").components, 4)).toBe(false);
    expect(membershipTemplateMatches([{ type: "BODY", text: "Hi {{name}}" }], 1)).toBe(false);
    expect(membershipTemplateMatches([...approved("appointment_reminder").components, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/{{1}}" }] }], 4)).toBe(false);
    expect(membershipTemplateMatches([{ type: "HEADER", format: "IMAGE" }, ...approved("platform_renewal").components], 4)).toBe(false);
  });

  it("preserves consent suppression and never falls back to another sender", async () => {
    vi.mocked(WhatsAppConsent.findOne).mockImplementation(() => query(null));
    const row = await enqueueWhatsAppDomainEvent(event, user);
    expect(row).toMatchObject({ status: "SUPPRESSED", policyDecision: "CONSENT_MISSING" });
    vi.mocked(WhatsAppConnection.findOne).mockImplementation(() => query(null));
    expect(await enqueueWhatsAppDomainEvent(event, user)).toBeUndefined();
  });

  it("skips disabled events, unavailable templates, and unsupported template revisions", async () => {
    connection.eventPreferences = { disabledEvents: [event.event] };
    await enqueueWhatsAppDomainEvent(event, user);
    expect(WhatsAppTemplate.findOne).not.toHaveBeenCalled();
    connection.eventPreferences.disabledEvents = [];
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query(null));
    await enqueueWhatsAppDomainEvent(event, user);
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query(approved("appointment_reminder")));
    await enqueueWhatsAppDomainEvent(event, user);
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("does not announce a future expiry after the subscription has already expired", async () => {
    subscription.endsAt = now;
    for (const name of ["membership.renewal_reminder", "platform.expiring"])
      await enqueueWhatsAppDomainEvent({ ...event, event: name }, user);
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("expires queued reminders at membership expiry and suppresses renewal/date changes before dispatch", async () => {
    subscription.endsAt = new Date(now.getTime() + 60_000);
    const row = await enqueueWhatsAppDomainEvent({ ...event, event: "membership.renewal_reminder" }, user);
    expect(row.expiresAt).toEqual(subscription.endsAt);
    expect(await membershipWhatsAppStillCurrent(row)).toBe(true);
    subscription.endsAt = new Date(now.getTime() + 86400000);
    expect(await evaluateWhatsAppDeliveryPolicy(row, connection)).toMatchObject({ allowed: false, final: true, reason: "MEMBERSHIP_CHANGED" });
  });

  it("suppresses superseded gym memberships and platform subscriptions", async () => {
    vi.mocked(MemberProfile.exists).mockImplementation(() => query(null));
    await enqueueWhatsAppDomainEvent(event, user);
    subscription.type = "PLATFORM";
    vi.mocked(Subscription.exists).mockImplementation(() => query({ _id: "renewed-subscription" }));
    await enqueueWhatsAppDomainEvent({ ...event, event: "platform.expiring" }, user);
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rechecks consent and template changes before dispatch", async () => {
    const row = await enqueueWhatsAppDomainEvent(event, user);
    vi.mocked(WhatsAppConsent.findOne).mockImplementation(() => query({ service: { grantedAt: now, withdrawnAt: now } }));
    expect(await evaluateWhatsAppDeliveryPolicy(row, connection)).toMatchObject({ reason: "CONSENT_MISSING" });
    vi.mocked(WhatsAppConsent.findOne).mockImplementation(() => query({ service: { grantedAt: now } }));
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query({ ...approved("welcome_msg_template"), category: "MARKETING" }));
    expect(await evaluateWhatsAppDeliveryPolicy(row, connection)).toMatchObject({ reason: "TEMPLATE_CATEGORY_MISMATCH" });
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query(approved("appointment_reminder")));
    expect(await evaluateWhatsAppDeliveryPolicy(row, connection)).toMatchObject({ reason: "TEMPLATE_PARAMETERS_MISMATCH" });
  });

  it.each([
    ["membership.activated", "welcome_msg_template"],
    ["membership.renewal_reminder", "appointment_reminder"],
    ["platform.expiring", "platform_renewal"],
  ])("dispatches %s through the durable worker to the Meta template endpoint", async (name, template) => {
    if (name === "platform.expiring") { subscription.type = "PLATFORM"; connection.scope = "PLATFORM"; }
    const row = await enqueueWhatsAppDomainEvent({ ...event, event: name }, user);
    vi.mocked(WhatsAppOutbox.findOneAndUpdate).mockReturnValueOnce(query(row));
    vi.spyOn(connections, "resolveWhatsAppSender").mockResolvedValue({ connection, token: "test-token" });
    for (const model of [WhatsAppOutbox, WhatsAppMessage, WhatsAppConversation, MemberCommunication])
      vi.spyOn(model, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await processWhatsAppOutbox(1)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/v26.0/phone-number/messages");
    expect(JSON.parse(options.body)).toMatchObject({
      messaging_product: "whatsapp", to: "919876543210", type: "template",
      template: { name: template, language: { code: "en_US" }, components: row.template.parameters },
    });
    expect(WhatsAppOutbox.updateOne).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ $set: expect.objectContaining({ status: "ACCEPTED", providerMessageId: "wamid.test" }) }));
  });
});
