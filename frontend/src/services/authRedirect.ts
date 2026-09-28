import type { OwnerOnboarding } from "./session";

type AuthAccount = { activeRole?: string; roles?: string[]; onboarding?: OwnerOnboarding };
export type AuthIdentity = string | AuthAccount | { user?: AuthAccount; context?: { role: string } };
const publicPolicyDestination = /^\/(?:terms-and-policies|terms-and-conditions|privacy-policy|refund-cancellation-policy|data-deletion)(?:[?#]|$)/;
function account(identity: AuthIdentity): AuthAccount {
  if (typeof identity === "string") return { activeRole: identity };
  if ("context" in identity || "user" in identity) {
    const session = identity as { user?: AuthAccount; context?: { role: string } };
    return { ...session.user, activeRole: session.context?.role || session.user?.activeRole };
  }
  return identity as AuthAccount;
}
export function canRegisterGym(identity: AuthIdentity): boolean {
  const user = account(identity);
  return [user.activeRole, ...(user.roles || [])].some(role => role === "GYM_OWNER" || role === "ADMIN");
}
export function needsOwnerOnboarding(identity: AuthIdentity): boolean {
  const user = account(identity);
  return user.activeRole === "GYM_OWNER" && Boolean(user.onboarding && user.onboarding.state !== "ACTIVE");
}

// Only local, known application destinations may be restored after authentication.
export function safeReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return;
  if (
    !/^\/(?:gyms\/[^/?#]+|activate-account|register-gym|platform-renewal|help|contact|terms-and-policies|terms-and-conditions|privacy-policy|refund-cancellation-policy|data-deletion|legal\/(?:terms|privacy)|notifications|messages(?:\/[A-Za-z0-9_-]+)?|profile(?:\/[A-Za-z0-9_-]+)?|(?:app|owner|trainer|admin)\/[^?#]+)(?:[?#].*)?$/.test(
      value,
    )
  )
    return;
  const url = new URL(value, "https://getfit4u.invalid");
  if (url.pathname !== value.split(/[?#]/)[0]) return;
  return value;
}

// Account services remain available while gym operations await onboarding.
// Keep these exact routes aligned with App and LiveWorkspace; no namespace wildcard.
export function isOwnerAccountDestination(value: unknown): boolean {
  const safe = safeReturnTo(value);
  return Boolean(
    safe &&
      (publicPolicyDestination.test(safe) ||
        /^\/(?:owner\/(?:support|security|help|contact|notifications|messages|profile(?:\/[A-Za-z0-9_-]+)?|legal\/(?:terms|privacy))|activate-account|help|contact|legal\/(?:terms|privacy)|notifications|messages(?:\/[A-Za-z0-9_-]+)?|profile(?:\/[A-Za-z0-9_-]+)?)(?:[?#].*)?$/.test(
          safe,
        )),
  );
}

export function authPath(path: string, returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `${path}?returnTo=${encodeURIComponent(safe)}` : path;
}

export function loginDestination(identity: AuthIdentity, returnTo?: string): string {
  const user = account(identity), role = user.activeRole || "USER";
  const safe = safeReturnTo(returnTo);
  if (needsOwnerOnboarding(identity)) return safe && isOwnerAccountDestination(safe) ? safe : "/register-gym";
  const home =
    role === "ADMIN"
      ? "/admin/dashboard"
      : ["GYM_OWNER", "GYM_STAFF"].includes(role)
        ? "/owner/dashboard"
        : role === "TRAINER"
          ? "/trainer/dashboard"
          : "/app/home";
  if (safe && /^\/(?:register-gym|(?:app|owner|trainer|admin)\/onboarding)(?:[/?#]|$)/.test(safe) && !canRegisterGym(identity)) return home;
  return safe &&
    (publicPolicyDestination.test(safe) ||
      /^\/(gyms\/|legal\/(?:terms|privacy)(?:[?#]|$)|messages(?:\/|[?#]|$)|profile(?:\/|[?#]|$)|(?:activate-account|register-gym|platform-renewal|notifications|help|contact)(?:[?#]|$))/.test(
        safe,
      ) ||
      safe.startsWith(`/${home.split("/")[1]}/`))
    ? safe
    : home;
}

export function workspacePrefix(role: string) {
  return role === "ADMIN"
    ? "/admin"
    : ["GYM_OWNER", "GYM_STAFF"].includes(role)
      ? "/owner"
      : role === "TRAINER"
        ? "/trainer"
        : "/app";
}
export function workspacePath(identity: AuthIdentity, path: string) {
  const role = account(identity).activeRole || "USER";
  const prefix = workspacePrefix(role);
  if (publicPolicyDestination.test(path)) return path;
  if (
    /^\/(explore(?:[?#]|$)|gyms\/|help(?:[?#]|$)|contact(?:[?#]|$)|legal\/)/.test(
      path,
    )
  )
    return needsOwnerOnboarding(identity) ? loginDestination(identity, prefix + path) : prefix + path;
  return loginDestination(identity, path);
}
