// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { messagePresets, prepareRecipients, renderWhatsAppMessage, recipientMessage, whatsAppDeepLinkProvider, type WhatsAppContext, type WhatsAppMember } from "./manualWhatsApp";

const context: WhatsAppContext = { gymName: "FitZone", ownerName: "Owner", timezone: "Asia/Kolkata", serverNow: "2026-11-11T09:00:00Z", group: { name: "FitZone Members", inviteLink: "https://chat.whatsapp.com/ABCDEFGHIJKL" } };
const member: WhatsAppMember = { publicId: "one", name: "Rahul", phone: "9876543210", chatUrl: "https://wa.me/919876543210", status: "ACTIVE", directAccess: false, renewalAmount: null, currentSubscriptionId: { status: "ACTIVE", startsAt: "2026-10-18T00:00:00Z", endsAt: "2026-11-17T18:30:00Z", planSnapshot: { name: "Gold Monthly" } } };
afterEach(() => vi.restoreAllMocks());
it.each(["renewal", "expiry", "payment", "welcome", "group"] as const)("personalizes %s with gym-local dates", type => {
  const result = recipientMessage(member, messagePresets[type].text, context);
  expect(result.issues).toEqual([]);
  expect(result.text).toContain("Hi Rahul,");
  expect(result.text).toContain("FitZone");
  expect(result.text).not.toContain("{{");
  if (type !== "group") expect(result.text).toContain("18 Nov 2026");
});
it("supports every available variable and never fabricates a renewal amount", () => {
  const result = renderWhatsAppMessage("{{memberName}} {{gymName}} {{planName}} {{expiryDate}} {{daysRemaining}} {{ownerName}}", context, member);
  expect(result.text).toBe("Rahul FitZone Gold Monthly 18 Nov 2026 7 Owner");
  expect(renderWhatsAppMessage("₹{{renewalAmount}}", context, member).issues.join()).toContain("Renewal Amount is unavailable");
  expect(renderWhatsAppMessage(messagePresets.payment.text, context, member).text).not.toContain("₹");
  expect(renderWhatsAppMessage("₹{{renewalAmount}}", context, { ...member, renewalAmount: "1,000" }).text).toBe("₹1,000");
});
it("rejects missing details, malformed placeholders, injected placeholders and empty messages", () => {
  expect(recipientMessage({ ...member, chatUrl: null }, "Hi", context).issues.join()).toContain("valid mobile number");
  expect(renderWhatsAppMessage("{{groupInviteLink}}", { ...context, group: { name: "", inviteLink: "" } }, member).issues).not.toEqual([]);
  for (const template of ["", "{{unknown}}", "Hi {{memberName", "x".repeat(4001)]) expect(renderWhatsAppMessage(template, context, member).issues.length).toBeGreaterThan(0);
  expect(renderWhatsAppMessage("{{memberName}}", context, { ...member, name: "{{unknown}}" }).issues.length).toBeGreaterThan(0);
});
it("generic sharing cannot interpolate a selected member's personal details", () => {
  expect(renderWhatsAppMessage("Hello {{gymName}}", context)).toEqual({ text: "Hello FitZone", issues: [] });
  expect(renderWhatsAppMessage("Hi {{memberName}} {{expiryDate}} {{renewalAmount}}", context).issues).toHaveLength(3);
});
it("deduplicates recipients, personalizes each message and skips only invalid recipients", () => {
  const second = { ...member, publicId: "two", name: "Ravi", chatUrl: null };
  const queue = prepareRecipients([member, second, member], "Hi {{memberName}}", context);
  expect(queue).toHaveLength(2);
  expect(queue.map(item => [item.text, item.status])).toEqual([["Hi Rahul", "PENDING"], ["Hi Ravi", "SKIPPED"]]);
});
it("opens one properly encoded chat or generic share per explicit action", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const text = "Hi 💪\n₹100 & ? #";
  whatsAppDeepLinkProvider.openChat(member.chatUrl!, text);
  expect(open).toHaveBeenLastCalledWith(`${member.chatUrl}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  whatsAppDeepLinkProvider.openChat(member.chatUrl!);
  expect(open).toHaveBeenLastCalledWith(member.chatUrl, "_blank", "noopener,noreferrer");
  whatsAppDeepLinkProvider.openShare(text);
  expect(open).toHaveBeenLastCalledWith(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  expect(open).toHaveBeenCalledTimes(3);
  expect(() => whatsAppDeepLinkProvider.openChat("https://evil.test/123", text)).toThrow();
  expect(() => whatsAppDeepLinkProvider.openShare("{{memberName}}")).toThrow();
  expect(open).toHaveBeenCalledTimes(3);
});
