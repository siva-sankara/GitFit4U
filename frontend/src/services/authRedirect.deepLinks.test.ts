import { expect, it } from "vitest";
import { safeReturnTo, loginDestination } from "./authRedirect";
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
