import { expect, it } from "vitest";
import { authPath, loginDestination, safeReturnTo } from "./authRedirect";
const target = "/notification-open/507f1f77bcf86cd799439011";
it("keeps a notification through login for every role, including incomplete owners", () => {
  expect(authPath("/login", target)).toBe(`/login?returnTo=${encodeURIComponent(target)}`);
  for (const role of ["USER", "GYM_OWNER", "TRAINER", "ADMIN"]) expect(loginDestination(role, target)).toBe(target);
  expect(loginDestination({ activeRole: "GYM_OWNER", onboarding: { state: "DRAFT" } as never }, target)).toBe(target);
});
it("rejects malformed or external notification destinations", () => {
  for (const value of ["https://evil.example/notification-open/507f1f77bcf86cd799439011", "/notification-open/bad", "//evil.example", "/notification-open/507f1f77bcf86cd799439011/../logout"]) expect(safeReturnTo(value)).toBeUndefined();
});
