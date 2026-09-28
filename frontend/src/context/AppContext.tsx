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
import { safeReturnTo } from "../services/authRedirect";
import {
  savedTheme,
  resolveTheme,
  themeStorageKey,
  type ThemePreference,
} from "../services/theme";
import {
  createNotificationTracker,
  playNotificationSound,
  setNotificationSoundEnabled,
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
  toastActionUrl: string | undefined;
  dismissToast: () => void;
  notify: (message: string) => void;
}
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(),
    [role, setRole] = useState<Role>("USER"),
    [themePreference, updateTheme] = useState<ThemePreference>(savedTheme),
    [toast, setToast] = useState<string | null>(null),
    [toastActionUrl, setToastActionUrl] = useState<string | undefined>(),
    [authenticated, setAuthenticated] = useState(!!getAccessToken());
  const session = useSession({ publicPage: true });
  const theme = themePreference;
  useEffect(() => {
    const preference = session.data?.data.user.preferences?.theme;
    if (preference) {
      const migrated = resolveTheme(preference);
      updateTheme(migrated);
      try {
        localStorage.setItem(themeStorageKey, migrated);
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
      notify(
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
  const notify = (message: string) => {
    setToastActionUrl(undefined);
    setToast(message);
  };
  const dismissToast = () => {
    setToast(null);
    setToastActionUrl(undefined);
  };
  useEffect(() => {
    // Actionable alerts remain available for keyboard and assistive-technology
    // users until opened or dismissed; informational notices still expire.
    if (!toast || toastActionUrl) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast, toastActionUrl]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setAuthenticated(!!detail.token);
      if (detail.changedSession) {
        dismissToast();
        client.clear();
      }
    };
    window.addEventListener("gfu-auth", handler);
    return () => window.removeEventListener("gfu-auth", handler);
  }, [client]);
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false,
      unsubscribe = () => {},
      stopRealtime = () => {};
    let fetching = false;
    const tracker = createNotificationTracker((alert) => {
      if (disposed || !getAccessToken()) return;
      setToast(alert.title);
      setToastActionUrl(safeReturnTo(alert.actionUrl));
      void client.invalidateQueries({ queryKey: ["notifications"] });
      if (document.visibilityState === "visible" && document.hasFocus())
        void playNotificationSound();
    });
    const receive = async (alert: { id?: string }) => {
      if (!alert.id || !/^[a-f\d]{24}$/i.test(alert.id) || disposed) return;
      try {
        const result = await apiRequest<ApiEnvelope<InboxNotification>>(
          "/api/v1/users/me/notifications/" + alert.id,
        );
        if (!disposed && !result.data.readAt)
          tracker.receive({
            id: result.data._id,
            title: result.data.title,
            message: result.data.message,
            actionUrl: result.data.actionUrl,
          });
      } catch {
        /* Removed/read notifications and expired sessions stay silent. */
      }
    };
    void import("socket.io-client")
      .then(({ io }) => {
        if (disposed) return;
        const socket = io(
          (import.meta.env.VITE_API_URL || window.location.origin).replace(
            /\/$/,
            "",
          ),
          {
            auth: (done) => done({ token: getAccessToken() }),
            transports: ["websocket", "polling"],
          },
        );
        socket.on("notification.created", receive);
        const reconnect = () => {
          socket.disconnect();
          if (getAccessToken()) socket.connect();
        };
        window.addEventListener("gfu-auth", reconnect);
        stopRealtime = () => {
          window.removeEventListener("gfu-auth", reconnect);
          socket.disconnect();
        };
      })
      .catch(() => undefined);
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
        const stop = await push.listenForPush(receive);
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
      stopRealtime();
      window.removeEventListener("focus", refreshInbox);
      document.removeEventListener("visibilitychange", refreshInbox);
      window.removeEventListener("focus", sync);
      window.removeEventListener("gfu-push-change", sync);
    };
  }, [authenticated, client, session.data?.data.user._id]);
  useEffect(() => {
    setNotificationSoundEnabled(
      Boolean(
        authenticated && session.data?.data.user.notificationPreferences?.sound,
      ),
    );
  }, [
    authenticated,
    session.data?.data.user._id,
    session.data?.data.user.notificationPreferences?.sound,
  ]);
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
        toastActionUrl,
        dismissToast,
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
