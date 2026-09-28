import { expect, it } from "vitest";
import { gymTermsInput } from "./gymTermsRoutes.js";
it("normalizes plain gym terms without allowing actor/date mass assignment", () => {
  expect(gymTermsInput.parse({ text: "  Gym\u0000 terms\r\nSecond line  " }).text).toBe("Gym terms\nSecond line");
  expect(() => gymTermsInput.parse({ text: "Safe", updatedBy: "other-user" })).toThrow();
  expect(() => gymTermsInput.parse({ text: "x".repeat(20001) })).toThrow();
});
it("removes unsafe controls while retaining tabs and plain-text line breaks", () => {
  const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, code) => code));
  expect(gymTermsInput.parse({ text: `A${controls}\u007fB` }).text).toBe("A\t\n\rB");
});
