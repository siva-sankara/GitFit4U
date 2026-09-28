import { expect, it } from "vitest";
import { safeReturnTo, loginDestination, canRegisterGym, workspacePath } from "./authRedirect";
it("preserves gym-bound platform renewal reminders regardless of the currently active role", () => {
  const destination = "/platform-renewal?gym=owned_gym_123";
  for (const role of ["USER", "TRAINER", "GYM_OWNER", "GYM_STAFF", "ADMIN"])
    expect(loginDestination(role, destination)).toBe(destination);
  expect(safeReturnTo("/platform-renewal/unknown")).toBeUndefined();
});
it("restores an authenticated social profile link without accepting unknown paths", () => {
  expect(loginDestination("USER", "/profile/member_123")).toBe("/profile/member_123");
  expect(loginDestination("GYM_OWNER", "/profile/member_123")).toBe("/profile/member_123");
  expect(safeReturnTo("/profile/member_123/unknown")).toBeUndefined();
});
it("preserves exact message destinations through authentication for every role", () => {
  for (const role of ["USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"]) expect(loginDestination(role, "/messages/conversation_123")).toBe("/messages/conversation_123");
  expect(safeReturnTo("/messages?conversation=conversation_123")).toBe("/messages?conversation=conversation_123");
});
it.each(["//external.test", "https://external.test", "/messages/../admin", "/messages/unsafe\\path", "/messages/space path"])("rejects unsafe notification redirect %s", path => expect(safeReturnTo(path)).toBeUndefined());
it("rejects every ASCII control character and space in a return destination", () => {
  for (let code = 0; code <= 32; code++) {
    expect(safeReturnTo(`/messages/a${String.fromCharCode(code)}b`)).toBeUndefined();
  }
});
it("keeps new, draft and pending owners in persisted onboarding while active owners enter their workspace", () => {
  for (const state of ["NOT_STARTED", "DRAFT", "PENDING", "CHANGES_REQUESTED", "SUSPENDED"] as const)
    expect(loginDestination({ activeRole: "GYM_OWNER", onboarding: { state } }, "/owner/members")).toBe("/register-gym");
  expect(loginDestination({ activeRole: "GYM_OWNER", onboarding: { state: "ACTIVE" } })).toBe("/owner/dashboard");
});
it("blocks registration deep links for ordinary members while preserving legitimate multiple roles", () => {
  expect(loginDestination("USER", "/register-gym")).toBe("/app/home");
  expect(loginDestination("USER", "/app/onboarding/first")).toBe("/app/home");
  expect(canRegisterGym({ context: { role: "USER" }, user: { roles: ["USER", "GYM_OWNER"] } })).toBe(true);
  expect(canRegisterGym("GYM_STAFF")).toBe(false);
});
const pendingOwner = { activeRole: "GYM_OWNER", onboarding: { state: "PENDING" as const } };
it.each(["/owner/help", "/owner/contact", "/owner/support", "/owner/security", "/owner/profile", "/owner/profile/member_123", "/owner/notifications", "/owner/messages?conversation=thread_123", "/notifications", "/messages/thread_123", "/profile", "/activate-account", "/contact"])("restores permitted account return destination %s during owner onboarding", path => {
  expect(loginDestination(pendingOwner, path)).toBe(path);
});
it.each(["/owner/dashboard", "/owner/members", "/admin/support", "/app/messages", "/owner/messages/unknown", "/owner/support/unknown", "/owner/messages/../members", "//evil.example/owner/help"])("does not restore operational, cross-role or unsafe destination %s during onboarding", path => {
  expect(loginDestination(pendingOwner, path)).toBe("/register-gym");
});
it.each(["/help", "/contact", "/legal/privacy", "/legal/terms"])("moves public account page %s into the allowed owner workspace without a loop", path => {
  expect(workspacePath(pendingOwner, path)).toBe(`/owner${path}`);
  expect(loginDestination(pendingOwner, `/owner${path}`)).toBe(`/owner${path}`);
});
it("keeps every published policy public for every role, including owner onboarding", () => {
  const policies = [
    "/terms-and-policies",
    "/terms-and-conditions",
    "/privacy-policy",
    "/refund-cancellation-policy",
    "/data-deletion",
  ];
  for (const role of ["USER", "GYM_OWNER", "GYM_STAFF", "TRAINER", "ADMIN"]) {
    for (const path of policies) {
      expect(workspacePath(role, path)).toBe(path);
      expect(loginDestination(role, path)).toBe(path);
    }
  }
  for (const path of policies) {
    expect(loginDestination(pendingOwner, path)).toBe(path);
    expect(safeReturnTo(path)).toBe(path);
  }
});
