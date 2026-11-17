export const razorpayCallbackPath = "/api/v1/payments/razorpay/oauth/callback";
export const razorpayResultPath = "/razorpay-connection-result";
export const razorpayAttemptTtlMs = 10 * 60_000;
export const razorpayOAuthFlowVersion = 2;

export function oauthOriginsMixLocalAndPublic(frontend: URL, callback: URL) {
  const local = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return local(frontend) !== local(callback);
}

export function oauthHttpUrl(value: string, production: boolean): URL | undefined {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash || url.search ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && local && !production))) return;
    return url;
  } catch { return; }
}

export function oauthUrlBlockers(config: {
  NODE_ENV?: string;
  FRONTEND_URL?: string;
  RAZORPAY_OAUTH_REDIRECT_URI?: string;
}) {
  const blockers: string[] = [];
  const production = config.NODE_ENV === "production";
  const frontend = oauthHttpUrl(config.FRONTEND_URL || "", production);
  if (!frontend || frontend.pathname !== "/")
    blockers.push("FRONTEND_URL must be the website origin, using HTTPS in production.");
  const callback = oauthHttpUrl(config.RAZORPAY_OAUTH_REDIRECT_URI || "", production);
  if (!callback || callback.pathname !== razorpayCallbackPath)
    blockers.push(`RAZORPAY_OAUTH_REDIRECT_URI must use HTTPS (or local development HTTP) and the exact path ${razorpayCallbackPath}, without query parameters.`);
  return blockers;
}
