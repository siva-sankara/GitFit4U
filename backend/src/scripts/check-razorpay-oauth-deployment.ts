import "dotenv/config";
import { oauthHttpUrl, razorpayCallbackPath, razorpayOAuthFlowVersion, razorpayResultPath } from "../config/razorpayOAuth.js";

// A request WITHOUT code or state only checks the deployed handler. It cannot
// connect a merchant, consume a real attempt, or create a payment.
const configured = process.argv[2] || process.env.RAZORPAY_OAUTH_REDIRECT_URI || "";
const url = oauthHttpUrl(configured, false);
if (!url || url.pathname !== razorpayCallbackPath) {
  console.error("Supply the callback URL without query parameters, or configure RAZORPAY_OAUTH_REDIRECT_URI.");
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "Cache-Control": "no-cache" } });
    const location = response.headers.get("location");
    const target = location ? new URL(location, url) : undefined;
    const version = response.headers.get("x-getfit4u-oauth-flow");
    const body = response.headers.get("content-type")?.includes("application/json") ? await response.json().catch(() => null) as any : null;
    const providerCode = typeof body?.error?.code === "string" && /^[A-Z_]{1,80}$/.test(body.error.code) ? body.error.code : undefined;
    const current = response.status === 303 && version === String(razorpayOAuthFlowVersion) &&
      target?.pathname === razorpayResultPath && response.headers.get("cache-control")?.includes("no-store");
    console.log(JSON.stringify({ callbackOrigin: url.origin, status: response.status, oauthFlowVersion: version,
      resultOrigin: target?.origin, resultPath: target?.pathname, errorCode: providerCode,
      updatedHandlerDeployed: Boolean(current),
      nextStep: current ? "Start a fresh Connect Razorpay attempt from the configured website."
        : providerCode === "RAZORPAY_OAUTH_STATE_INVALID" ? "The old callback handler is still deployed. Deploy the updated backend source."
        : "Check the backend deployment, configuration and proxy/security rules." }, null, 2));
    if (!current) process.exitCode = 1;
  } catch {
    console.error("Could not reach the callback. Check backend availability and network access.");
    process.exitCode = 1;
  }
}
