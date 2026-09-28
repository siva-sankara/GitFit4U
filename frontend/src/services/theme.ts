export type ThemePreference = "light" | "dark";
export const themeStorageKey = "gfu_theme_preference";
// Legacy System and missing/invalid preferences migrate to Light on every surface.
export function resolveTheme(preference: unknown): ThemePreference {
  return preference === "dark" ? "dark" : "light";
}
export function savedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    const preference = resolveTheme(value);
    if (value !== preference) localStorage.setItem(themeStorageKey, preference);
    return preference;
  } catch {
    return "light";
  }
}
