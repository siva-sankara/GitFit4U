// @vitest-environment jsdom
import { expect, it } from "vitest";
import { resolveTheme, savedTheme, themeStorageKey } from "./theme";
it("defaults to System and tracks the operating system without overriding explicit modes", () => {
  localStorage.removeItem(themeStorageKey);
  expect(savedTheme()).toBe("system");
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
  localStorage.setItem(themeStorageKey, "dark");
  expect(savedTheme()).toBe("dark");
});
