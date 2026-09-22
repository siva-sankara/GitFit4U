import { describe, expect, it } from "vitest";
import { gyms, members, registrations } from "./demo";

describe("approved preview fixtures", () => {
  it("keeps public gym routes stable and unique", () => {
    expect(gyms.length).toBeGreaterThanOrEqual(3);
    expect(new Set(gyms.map((gym) => gym.slug)).size).toBe(gyms.length);
    expect(gyms.every((gym) => gym.price > 0 && gym.distance >= 0)).toBe(true);
  });

  it("contains representative owner and admin operational states", () => {
    expect(members.some((member) => member.status === "Active")).toBe(true);
    expect(members.some((member) => member.status !== "Active")).toBe(true);
    expect(registrations.some((registration) => registration.completion < 100)).toBe(true);
  });
});
