import { Moon, Sun } from "lucide-react";
import { useApp } from "../context/AppContext";
export function ThemePicker() {
  const { themePreference, setThemePreference } = useApp();
  return (
    <div className="theme-icon-picker" role="group" aria-label="Appearance">
      {(
        [
          { value: "light", label: "Light theme", Icon: Sun },
          { value: "dark", label: "Dark theme", Icon: Moon },
        ] as const
      ).map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="icon-btn"
          aria-label={label}
          title={label}
          aria-pressed={(themePreference || "light") === value}
          onClick={() => setThemePreference(value)}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}
