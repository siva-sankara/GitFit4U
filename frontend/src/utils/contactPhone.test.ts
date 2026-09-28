import { expect, it } from "vitest";
import { normalizeContactPhone } from "./contactPhone";
it("normalizes Indian registered numbers while preserving explicit international prefixes", () => {
  expect(normalizeContactPhone("98765 43210")).toBe("+919876543210");
  expect(normalizeContactPhone("91 98765 43210")).toBe("+919876543210");
  expect(normalizeContactPhone("09876543210")).toBe("+919876543210");
  expect(normalizeContactPhone("+1 (212) 555-1234")).toBe("+12125551234");
  expect(normalizeContactPhone("+44 20 7946 0958")).toBe("+442079460958");
});
it("does not create links from missing numbers, text, extensions or URI injection", () => {
  for (const value of [undefined, null, "", "123", "invalid", "+12;123", "9876543210#1", "tel:+919876543210", "++919876543210", "123456789012345678"]) expect(normalizeContactPhone(value)).toBeUndefined();
});
