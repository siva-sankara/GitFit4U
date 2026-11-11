import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js", () => ({ env: { WHATSAPP_CONFIGURATION_LEGACY: false, WHATSAPP_TEMPLATE_WELCOME: "member_welcome_message", WHATSAPP_TEMPLATE_MEMBERSHIP_ACTIVATED: "membership_activated", WHATSAPP_TEMPLATE_PLATFORM_RENEWAL: "gym_platform_renewal_reminder", WHATSAPP_TEMPLATE_LANGUAGE: "en_US" } }));
import { Payment, Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { ClassBooking, ClassSession, Trainer } from "../models/Engagement.js";
import { buildMembershipWhatsAppComponents } from "./whatsappMembershipTemplateService.js";
import { resolveTransactionalWhatsAppTemplate } from "./whatsappTransactionalTemplateService.js";
const query = (value: unknown): any => { const q = Promise.resolve(value) as any; for (const key of ["select", "session", "lean"]) q[key] = () => q; return q; };
const now = new Date("2026-11-11T06:00:00Z");
const gym = { name: "FitZone", timezone: "Asia/Kolkata" };
const user = { name: " Rahul \n Kumar " };
const sub = { startsAt: new Date("2026-11-10T18:30:00Z"), endsAt: new Date("2026-12-10T18:30:00Z"), planSnapshot: { name: "Monthly", totalMinor: 123456 } };
const event = { event: "payment.successful", userId: "user", gymId: "gym", entityId: "payment-public" };
beforeEach(() => {
  vi.spyOn(Gym, "findOne").mockImplementation(() => query(gym));
  vi.spyOn(Payment, "findOne").mockImplementation(() => query({ publicId: "payment-public", amountMinor: 123456, currency: "INR", subscriptionId: "sub" }));
  vi.spyOn(Subscription, "findOne").mockImplementation(() => query(sub));
  vi.spyOn(MemberProfile, "exists").mockImplementation(() => query({ _id: "member" }));
  vi.spyOn(ClassBooking, "findOne").mockImplementation(() => query({ memberProfileId: "member", sessionId: "session" }));
  vi.spyOn(ClassSession, "findOne").mockImplementation(() => query({ name: "Strength", startsAt: new Date("2026-11-12T00:30:00Z"), trainerId: "trainer" }));
  vi.spyOn(Trainer, "findOne").mockImplementation(() => query({ name: "Priya" }));
});
afterEach(() => vi.restoreAllMocks());
describe("server-owned utility template payloads", () => {
  it.each(["membership.welcome", "membership.activated"] as const)("builds the configured five-value %s contract", eventName => {
    expect(buildMembershipWhatsAppComponents(eventName, user, gym, sub)[0].parameters.map(p => p.text)).toEqual(["Rahul Kumar", "FitZone", "Monthly", "11-11-2026", "11-12-2026"]);
  });
  it("uses the authoritative gym name for the new platform-renewal contract", () => {
    expect(buildMembershipWhatsAppComponents("platform.expiring", user, gym, sub)[0].parameters.map(p => p.text)).toEqual(["Rahul Kumar", "FitZone", "11-12-2026", "1234.56"]);
  });
  it.each(["payment.successful", "payment.offline"])("uses a captured payment and the matching membership for %s", async name => {
    const result = await resolveTransactionalWhatsAppTemplate({ ...event, event: name }, user, now);
    expect(result?.parameters[0].parameters.map(p => p.text)).toEqual(["Rahul Kumar", "FitZone", "1234.56", "Monthly", "payment-public", "11-11-2026", "11-12-2026"]);
    expect(Payment.findOne).toHaveBeenCalledWith(expect.objectContaining({ payerId: "user", gymId: "gym", status: "CAPTURED", purpose: "MEMBERSHIP" }));
    expect(Subscription.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: "sub", userId: "user", gymId: "gym" }));
  });
  it("does not build a payment confirmation for an unverified/missing payment", async () => {
    vi.mocked(Payment.findOne).mockImplementation(() => query(null));
    expect(await resolveTransactionalWhatsAppTemplate(event, user, now)).toBeNull();
  });
  it.each(["class.booked", "class.cancelled"])("resolves %s details through a booking owned by the recipient", async name => {
    const result = await resolveTransactionalWhatsAppTemplate({ ...event, event: name, entityId: "507f1f77bcf86cd799439011" }, user, now);
    const values = result?.parameters[0].parameters.map(p => p.text);
    expect(values?.slice(0, 4)).toEqual(["Rahul Kumar", "FitZone", "Strength", "12-11-2026"]);
    expect(values?.[4]).toMatch(/06:00/); expect(values?.[5]).toBe("Priya");
    expect(ClassBooking.findOne).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym", status: name === "class.cancelled" ? "CANCELLED" : "BOOKED" }));
    expect(MemberProfile.exists).toHaveBeenCalledWith({ _id: "member", gymId: "gym", userId: "user" });
  });
  it("rejects another member's booking before retrieving class details", async () => {
    vi.mocked(MemberProfile.exists).mockImplementation(() => query(null));
    expect(await resolveTransactionalWhatsAppTemplate({ ...event, event: "class.booked", entityId: "507f1f77bcf86cd799439011" }, user, now)).toBeNull();
    expect(ClassSession.findOne).not.toHaveBeenCalled();
  });
});
