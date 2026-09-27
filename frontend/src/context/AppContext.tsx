import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  getAccessToken,
  type ApiEnvelope,
} from "../services/apiClient";
import type { Role } from "../types";
import { useSession } from "../services/session";
import {
  savedTheme,
  resolveTheme,
  themeStorageKey,
  type ThemePreference,
} from "../services/theme";
import {
  createNotificationTracker,
  playNotificationSound,
  type InboxNotification,
} from "../services/notificationAlerts";
interface AppContextValue {
  role: Role;
  setRole: (role: Role) => void;
  theme: "dark" | "light";
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  favorites: string[];
  toggleFavorite: (gymId: string) => void;
  toast: string | null;
  notify: (message: string) => void;
}
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(),
    [role, setRole] = useState<Role>("USER"),
    [themePreference, updateTheme] = useState<ThemePreference>(savedTheme),
    [systemDark, setSystemDark] = useState(
      () =>
        window.matchMedia?.("(prefers-color-scheme: dark)").matches || false,
    ),
    [toast, setToast] = useState<string | null>(null),
    [authenticated, setAuthenticated] = useState(!!getAccessToken());
  const session = useSession({ publicPage: true });
  const theme = resolveTheme(themePreference, systemDark);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media?.matches || false);
    media?.addEventListener?.("change", change);
    return () => media?.removeEventListener?.("change", change);
  }, []);
  useEffect(() => {
    const preference = session.data?.data.user.preferences?.theme;
    if (preference) {
      updateTheme(preference);
      try {
        localStorage.setItem(themeStorageKey, preference);
      } catch {
        /* Browser storage may be disabled. Account preference remains available. */
      }
    }
  }, [session.data?.data.user._id, session.data?.data.user.preferences?.theme]);
  const saveTheme = useMutation({
    mutationFn: (preference: ThemePreference) =>
      apiRequest("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({ preferences: { theme: preference } }),
      }),
    onError: (error) =>
      setToast(
        `Theme changed on this device. Account preference could not be saved: ${error.message}`,
      ),
  });
  const setThemePreference = (preference: ThemePreference) => {
    updateTheme(preference);
    try {
      localStorage.setItem(themeStorageKey, preference);
    } catch {
      /* The current session still applies the selection. */
    }
    if (getAccessToken()) {
      client.setQueryData(["me"], (old: any) =>
        old
          ? {
              ...old,
              data: {
                ...old.data,
                user: {
                  ...old.data.user,
                  preferences: {
                    ...old.data.user.preferences,
                    theme: preference,
                  },
                },
              },
            }
          : old,
      );
      saveTheme.mutate(preference);
    }
  };
  const favorites = useQuery({
    queryKey: ["favorites"],
    enabled: authenticated,
    queryFn: () => apiRequest<ApiEnvelope<any[]>>("/api/v1/users/me/favorites"),
  });
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setAuthenticated(!!detail.token);
      if (detail.changedSession) {
        client.clear();
      }
    };
    window.addEventListener("gfu-auth", handler);
    return () => window.removeEventListener("gfu-auth", handler);
  }, [client]);
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false,
      unsubscribe = () => {};
    let fetching = false;
    const tracker = createNotificationTracker((alert) => {
      if (disposed || !getAccessToken()) return;
      setToast(alert.title);
      void client.invalidateQueries({ queryKey: ["notifications"] });
      if (document.visibilityState === "visible" && document.hasFocus())
        void playNotificationSound();
    });
    const refreshInbox = async () => {
      if (
        disposed ||
        fetching ||
        !getAccessToken() ||
        document.visibilityState === "hidden"
      )
        return;
      fetching = true;
      try {
        const result = await client.fetchQuery({
          queryKey: ["notifications", 1, "ALL"],
          queryFn: ({ signal }) =>
            apiRequest<ApiEnvelope<InboxNotification[]>>(
              "/api/v1/users/me/notifications?page=1&category=ALL",
              { signal },
            ),
          staleTime: 10_000,
        });
        if (!disposed) {
          tracker.observe(result.data);
        }
      } catch {
        // The inbox page owns error/retry UI. Keep background refresh unobtrusive.
      } finally {
        fetching = false;
      }
    };
    const sync = () => {
      void import("../services/firebasePush")
        .then((push) => push.syncPushToken())
        .catch(() => {
          /* Settings offers an explicit retry. */
        });
    };
    void import("../services/firebasePush")
      .then(async (push) => {
        const stop = await push.listenForPush(tracker.receive);
        if (disposed) stop();
        else unsubscribe = stop;
        if (!disposed) sync();
      })
      .catch(() => undefined);
    void refreshInbox();
    const inboxTimer = window.setInterval(() => void refreshInbox(), 30_000);
    window.addEventListener("focus", refreshInbox);
    document.addEventListener("visibilitychange", refreshInbox);
    window.addEventListener("focus", sync);
    window.addEventListener("gfu-push-change", sync);
    return () => {
      disposed = true;
      clearInterval(inboxTimer);
      unsubscribe();
      window.removeEventListener("focus", refreshInbox);
      document.removeEventListener("visibilitychange", refreshInbox);
      window.removeEventListener("focus", sync);
      window.removeEventListener("gfu-push-change", sync);
    };
  }, [authenticated, client]);
  const ids = (favorites.data?.data || []).flatMap((row) =>
    row.gymId?.publicId ? [row.gymId.publicId] : [],
  );
  const favorite = useMutation({
    mutationFn: (gymId: string) =>
      apiRequest(`/api/v1/users/me/favorites/${encodeURIComponent(gymId)}`, {
        method: ids.includes(gymId) ? "DELETE" : "POST",
      }),
    onSuccess: () => client.invalidateQueries(),
    onError: (e) => notify(e.message),
  });
  return (
    <AppContext.Provider
      value={{
        role,
        setRole,
        theme,
        themePreference,
        setThemePreference,
        toggleTheme: () =>
          setThemePreference(theme === "light" ? "dark" : "light"),
        favorites: ids,
        toggleFavorite: (gymId) => {
          if (!authenticated) {
            window.location.assign("/auth/login");
            return;
          }
          if (!favorite.isPending) favorite.mutate(gymId);
        },
        toast,
        notify,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
