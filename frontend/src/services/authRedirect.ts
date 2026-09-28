// Only local, known application destinations may be restored after authentication.
export function safeReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return;
  if (
    !/^\/(?:gyms\/[^/?#]+|activate-account|register-gym|platform-renewal|notifications|messages(?:\/[A-Za-z0-9_-]+)?|profile(?:\/[A-Za-z0-9_-]+)?|(?:app|owner|trainer|admin)\/[^?#]+)(?:[?#].*)?$/.test(
      value,
    )
  )
    return;
  const url = new URL(value, "https://getfit4u.invalid");
  if (url.pathname !== value.split(/[?#]/)[0]) return;
  return value;
}

export function authPath(path: string, returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `${path}?returnTo=${encodeURIComponent(safe)}` : path;
}

export function loginDestination(role: string, returnTo?: string): string {
  const home =
    role === "ADMIN"
      ? "/admin/dashboard"
      : ["GYM_OWNER", "GYM_STAFF"].includes(role)
        ? "/owner/dashboard"
        : role === "TRAINER"
          ? "/trainer/dashboard"
          : "/app/home";
  const safe = safeReturnTo(returnTo);
  return safe &&
    (/^\/(gyms\/|messages(?:\/|[?#]|$)|profile(?:\/|[?#]|$)|(?:activate-account|register-gym|platform-renewal|notifications)(?:[?#]|$))/.test(
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
export function workspacePath(role: string, path: string) {
  const prefix = workspacePrefix(role);
  if (
    /^\/(explore(?:[?#]|$)|gyms\/|help(?:[?#]|$)|contact(?:[?#]|$)|legal\/)/.test(
      path,
    )
  )
    return prefix + path;
  return loginDestination(role);
}
