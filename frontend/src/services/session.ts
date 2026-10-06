import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import {
  apiRequest,
  ApiError,
  flushPendingLogout,
  getAccessToken,
  hasPendingLogout,
  hasPersistedSession,
  refreshSession,
  type ApiEnvelope,
} from "./apiClient";
import type { Role } from "../types";

export type ActiveRole = Role | "GYM_STAFF";
export interface OwnerOnboarding {
  state: "NOT_STARTED" | "DRAFT" | "PENDING" | "ACTIVE" | "CHANGES_REQUESTED" | "SUSPENDED";
  registrationId?: string;
  gymId?: string;
  currentStep?: string;
}
export interface SessionData {
  user: {
    _id: string;
    publicId: string;
    name?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string;
    avatarThumbnailUrl?: string;
    preferences?: { theme?: "system" | "light" | "dark" };
    notificationPreferences?: { sound?: boolean; push?: boolean; categories?: string[] };
    roles: ActiveRole[];
    activeRole: ActiveRole;
    onboarding?: OwnerOnboarding;
  };
  context: {
    userId: string;
    role: ActiveRole;
    gymId?: string;
    permissions: string[];
    sessionId: string;
  };
  assignments: Array<{
    role: ActiveRole;
    gymId: {
      _id: string;
      publicId: string;
      name: string;
      status: string;
      logoUrl?: string;
    } | null;
    permissions: string[];
  }>;
}

export async function readSession() {
  if (!getAccessToken()) await refreshSession();
  const token = getAccessToken();
  try {
    return await apiRequest<ApiEnvelope<SessionData>>("/api/v1/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (getAccessToken() === token) await refreshSession();
    return apiRequest<ApiEnvelope<SessionData>>("/api/v1/auth/me");
  }
}
function subscribeToAuth(onChange: () => void) {
  window.addEventListener("gfu-auth", onChange);
  return () => window.removeEventListener("gfu-auth", onChange);
}

export function useSession({
  publicPage = false,
  recoverSession = false,
}: { publicPage?: boolean; recoverSession?: boolean } = {}) {
  const token = useSyncExternalStore(
    subscribeToAuth,
    getAccessToken,
    () => null,
  );
  return useQuery({
    queryKey: ["me"],
    queryFn: readSession,
    // The non-secret durable hint lets auth entry screens recover a valid
    // HttpOnly refresh cookie without probing for every anonymous visitor.
    enabled: !publicPage || Boolean(token) || (recoverSession && hasPersistedSession()),
    retry: (attempt, error) =>
      attempt < 1 && error instanceof ApiError &&
      (error.status === 0 || error.status === 429 || error.status >= 500),
    retryOnMount: true,
    staleTime: 60_000,
    // Lifecycle reconciliation below replaces session keep-alive polling.
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

/** Revalidates an existing session after real browser/PWA resume boundaries. */
export function useSessionLifecycle() {
  const client = useQueryClient();
  useEffect(() => {
    let timer = 0;
    const reconcile = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "hidden") return;
        if (hasPendingLogout()) {
          try { await flushPendingLogout(); } catch { return; }
          return;
        }
        if (!hasPersistedSession()) return;
        const state = client.getQueryState(["me"]);
        const lastSettled = Math.max(state?.dataUpdatedAt || 0, state?.errorUpdatedAt || 0);
        if (Date.now() - lastSettled < 30_000) return;
        await client.refetchQueries({ queryKey: ["me"], type: "active" });
      }, 150);
    };
    const visible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    reconcile();
    window.addEventListener("pageshow", reconcile);
    window.addEventListener("online", reconcile);
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", reconcile);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client]);
}
