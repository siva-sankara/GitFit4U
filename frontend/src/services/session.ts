import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  apiRequest,
  ApiError,
  getAccessToken,
  refreshSession,
  type ApiEnvelope,
} from "./apiClient";
import type { Role } from "../types";

export type ActiveRole = Role | "GYM_STAFF";
export interface SessionData {
  user: {
    _id: string;
    publicId: string;
    name?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string;
    roles: ActiveRole[];
    activeRole: ActiveRole;
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
    } | null;
    permissions: string[];
  }>;
}

export async function readSession() {
  if (!getAccessToken()) await refreshSession();
  try {
    return await apiRequest<ApiEnvelope<SessionData>>("/api/v1/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refreshSession();
    return apiRequest<ApiEnvelope<SessionData>>("/api/v1/auth/me");
  }
}
function subscribeToAuth(onChange: () => void) {
  window.addEventListener("gfu-auth", onChange);
  return () => window.removeEventListener("gfu-auth", onChange);
}

export function useSession({
  publicPage = false,
}: { publicPage?: boolean } = {}) {
  const token = useSyncExternalStore(
    subscribeToAuth,
    getAccessToken,
    () => null,
  );
  return useQuery({
    queryKey: ["me"],
    queryFn: readSession,
    // Public browsing never probes refresh cookies for anonymous visitors.
    enabled: !publicPage || Boolean(token),
    retry: false,
    retryOnMount: false,
    staleTime: 60_000,
    // Layouts and route guards share this result instead of checking on every navigation.
    refetchOnMount: false,
    refetchOnWindowFocus: true,
  });
}
