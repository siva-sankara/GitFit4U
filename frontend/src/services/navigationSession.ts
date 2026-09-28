import { useState } from "react";

const prefix = "getfit4u:navigation:";
export function navigationSessionScope(context?: { userId?: string; gymId?: string; sessionId?: string }) {
  if (!context?.userId || !context.sessionId) return undefined;
  return [context.sessionId, context.userId, context.gymId || "account"].map(encodeURIComponent).join(":");
}
export const navigationSessionKey = (scope: string, route: string) => `${prefix}${scope}:${route}`;
export function clearNavigationSession() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix) || key?.startsWith("getfit4u:list:")) sessionStorage.removeItem(key);
    }
  } catch { /* Navigation remains available when browser storage is disabled. */ }
}
export interface MemberListState { page: number; search: string; status: string; planId: string; trainerId: string }
const empty: MemberListState = { page: 1, search: "", status: "", planId: "", trainerId: "" };
const statuses = new Set(["JOIN_REQUESTED", "ACTIVE", "EXPIRING", "FROZEN", "EXPIRED", "CANCELLED", "DEACTIVATED", "GRACE", "PENDING_PAYMENT", "NONE"]);
function normalized(value: unknown): MemberListState {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    page: typeof row.page === "number" && Number.isSafeInteger(row.page) && row.page > 0 && row.page <= 100000 ? row.page : 1,
    search: typeof row.search === "string" ? row.search.slice(0, 200) : "",
    status: typeof row.status === "string" && statuses.has(row.status) ? row.status : "",
    planId: typeof row.planId === "string" ? row.planId.slice(0, 100) : "",
    trainerId: typeof row.trainerId === "string" ? row.trainerId.slice(0, 100) : "",
  };
}
function read(key?: string) {
  if (!key) return empty;
  try { return normalized(JSON.parse(sessionStorage.getItem(key) || "null")); } catch { return empty; }
}
/** Search terms never enter URLs, localStorage, or another user's/gym's session. */
export function useMemberListState(scope?: string): [MemberListState, (patch: Partial<MemberListState>) => void] {
  const key = scope ? navigationSessionKey(scope, "member-list") : undefined;
  const [entry, setEntry] = useState(() => ({ key, value: read(key) }));
  const value = entry.key === key ? entry.value : read(key);
  function update(patch: Partial<MemberListState>) {
    const next = normalized({ ...value, ...patch });
    setEntry({ key, value: next });
    if (key) try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Current page state still works. */ }
  }
  return [value, update];
}
