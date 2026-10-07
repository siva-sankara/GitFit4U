import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import {
  apiRequest,
  ApiError,
  getAccessToken,
  refreshSession,
  type ApiEnvelope,
} from "./apiClient";
import type { Role } from "../types";
import { trackSessionActivity } from "./sessionActivity";

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
  if (!getAccessToken()) await refreshSession({ activity: document.visibilityState === "visible" });
  return apiRequest<ApiEnvelope<SessionData>>("/api/v1/auth/me");
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
    // The app's initial cookie check must work even if local/session storage
    // was cleared. Persistence belongs to the cookie, never to a JS hint.
    enabled: !publicPage || Boolean(token) || recoverSession,
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
  useEffect(() => trackSessionActivity(() =>
    client.refetchQueries({ queryKey: ["me"], type: "active" }),
  ), [client]);
}
