import { useApp } from "../context/AppContext";
import type { ThemePreference } from "../services/theme";
export function ThemePicker() {
  const { themePreference, setThemePreference } = useApp();
  return (
    <label className="theme-picker">
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        value={themePreference || "Dark"}
        onChange={(event) =>
          setThemePreference(event.target.value as ThemePreference)
        }
      >
        {/* <option value="system">System </option> */}
        <option value="light">Light </option>
        <option value="dark">Dark </option>
      </select>
    </label>
  );
}
