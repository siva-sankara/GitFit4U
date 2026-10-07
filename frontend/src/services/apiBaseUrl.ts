/** Keep legacy Vercel API settings behind the frontend's /api/v1 rewrite. */
export function apiBaseUrl(configuredUrl = "", production = false): string {
  const value = configuredUrl.trim().replace(/\/$/, "");
  if (production && value && new URL(value).hostname.endsWith(".vercel.app")) {
    // A deployment environment variable overrides .env.production. Falling
    // back here keeps that stale setting from restoring cross-site cookies.
    return "";
  }
  return value;
}
