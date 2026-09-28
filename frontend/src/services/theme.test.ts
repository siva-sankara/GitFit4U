// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { resolveTheme, savedTheme, themeStorageKey } from "./theme";
afterEach(() => localStorage.clear());
it("defaults to Dark and migrates System without overriding explicit modes", () => {
  localStorage.removeItem(themeStorageKey);
  expect(savedTheme()).toBe("dark");
  expect(resolveTheme("system")).toBe("dark");
  expect(resolveTheme(undefined)).toBe("dark");
  expect(resolveTheme("invalid")).toBe("dark");
  expect(resolveTheme("light")).toBe("light");
  expect(resolveTheme("dark")).toBe("dark");
  localStorage.setItem(themeStorageKey, "system");
  expect(savedTheme()).toBe("dark");
  expect(localStorage.getItem(themeStorageKey)).toBe("dark");
  localStorage.setItem(themeStorageKey, "light");
  expect(savedTheme()).toBe("light");
  localStorage.setItem(themeStorageKey, "dark");
  expect(savedTheme()).toBe("dark");
});
