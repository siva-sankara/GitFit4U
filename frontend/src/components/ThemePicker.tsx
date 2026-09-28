import { Moon, Sun } from "lucide-react";
import { useApp } from "../context/AppContext";
export function ThemePicker() {
  const { themePreference, setThemePreference } = useApp();
  const nextTheme = themePreference === "dark" ? "light" : "dark";
  const label = `Switch to ${nextTheme} mode`;
  const Icon = nextTheme === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      className="icon-btn theme-icon-picker"
      aria-label={label}
      title={label}
      onClick={() => setThemePreference(nextTheme)}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
