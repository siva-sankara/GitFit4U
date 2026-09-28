// @vitest-environment jsdom
import { expect, it } from "vitest";
import { workspaceTrail } from "./WorkspaceBreadcrumbs";
it("uses an authorized parent for directly opened member details", () => {
  expect(workspaceTrail("/owner/members/member-a", "GYM_OWNER", ["member:read"])).toEqual([
    { label: "Dashboard", href: "/owner/dashboard" }, { label: "Members", href: "/owner/members" }, { label: "Details", href: "/owner/members/member-a" },
  ]);
});
it("does not offer unavailable parents, cross-role paths, or root back loops", () => {
  expect(workspaceTrail("/owner/members/member-a", "GYM_OWNER", [])).toEqual([]);
  expect(workspaceTrail("/admin/users", "USER", [])).toEqual([]);
  expect(workspaceTrail("/app/home", "USER", [])).toEqual([]);
});
it("labels the real camera route and uses the profile hub safely", () => {
  expect(workspaceTrail("/app/attendance/qr", "USER", []).at(-1)?.label).toBe("Scan gym QR");
  expect(workspaceTrail("/profile", "USER", []).at(0)?.href).toBe("/app/home");
});
it.each(["membership", "bookings", "payments", "attendance", "workouts", "favorites", "referrals", "social", "settings"])("labels the Profile %s section without exposing identifiers", section => {
  const trail = workspaceTrail("/app/profile", "USER", [], `?section=${section}`);
  expect(trail.at(-1)?.label.toLowerCase()).toBe(section);
  expect(trail.at(-2)?.href).toBe("/app/profile");
});
