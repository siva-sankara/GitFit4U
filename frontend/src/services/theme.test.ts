// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { resolveTheme, savedTheme, themeStorageKey } from "./theme";
afterEach(() => localStorage.clear());
it("defaults to Light and migrates System without overriding explicit modes", () => {
  localStorage.removeItem(themeStorageKey);
  expect(savedTheme()).toBe("light");
  expect(resolveTheme("system")).toBe("light");
  expect(resolveTheme(undefined)).toBe("light");
  expect(resolveTheme("invalid")).toBe("light");
  expect(resolveTheme("light")).toBe("light");
  expect(resolveTheme("dark")).toBe("dark");
  localStorage.setItem(themeStorageKey, "system");
  expect(savedTheme()).toBe("light");
  expect(localStorage.getItem(themeStorageKey)).toBe("light");
  localStorage.setItem(themeStorageKey, "dark");
  expect(savedTheme()).toBe("dark");
});
