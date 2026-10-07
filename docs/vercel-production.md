# Production domains on Vercel

The frontend and backend are separate Vercel projects. Local `.env` files are
ignored by Git and do not update Vercel's environment settings.

| Purpose | Address |
| --- | --- |
| Main frontend | https://www.getfit4u.in |
| Existing frontend alias | https://git-fit4-u.vercel.app |
| Current public backend production alias | https://git-fit4-u-un7d.vercel.app |
| Recommended backend custom domain, once configured | https://api.getfit4u.in |

The supplied backend URL containing `j3dojjnp4-get-fit4u` is tied to a specific
deployment. During verification on September 28, 2026, its OPTIONS request
redirected to Vercel SSO. The public production alias returned `/health` JSON,
but did not grant CORS access to either frontend domain. `api.getfit4u.in` did
not resolve at that time.

## Backend project

In Settings → Environment Variables, select **Production** and set the values
below, also available in `backend/production.env.example`:

```dotenv
NODE_ENV=production
MONGO_URI=mongodb+srv://<production-cluster>/<database>
CLIENT_ORIGIN=https://www.getfit4u.in,https://getfit4u.in,https://git-fit4-u.vercel.app
JWT_ACCESS_SECRET=<independent-random-value-at-least-48-characters>
JWT_REFRESH_SECRET=<different-random-value-at-least-48-characters>
AUTH_OTP_HMAC_SECRET=<different-random-value-at-least-48-characters>
ATTENDANCE_QR_SECRET=<different-random-value-at-least-48-characters>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=3d
LOG_LEVEL=info
```

`JWT_REFRESH_TTL=3d` is the rolling inactivity window. A visible visit or user
interaction renews it for another 72 hours. Background token renewal does not
extend this deadline. Update an existing Vercel `30d` value to `3d` and redeploy
both frontend and backend; the local `.env` change does not update Vercel.

Do not add `COOKIE_DOMAIN`; a host-only cookie is correct for both the
same-origin frontend proxy and `api.getfit4u.in`. Keep `www.getfit4u.in` first in
`CLIENT_ORIGIN`, since email and notification links use the first frontend.
Origins use the scheme and hostname, with no route path. A trailing slash is
normalized by the backend before CORS, CSRF, and Socket.IO consume the setting.

Keep the existing production database and provider credentials in Vercel.
Production requires independent `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`AUTH_OTP_HMAC_SECRET`, and `ATTENDANCE_QR_SECRET` values of at least 48
characters; development defaults are rejected. WhatsApp OTP additionally needs
the platform access token, WABA ID, phone-number ID, approved
`WHATSAPP_AUTH_TEMPLATE_NAME`, and its exact
`WHATSAPP_AUTH_TEMPLATE_LANGUAGE`. Do not copy secrets into this document or
public frontend variables.

The backend refuses to start in production with localhost MongoDB/origins,
development secrets, reused signing secrets, invalid TTL values, or insecure
frontend origins. Keep all existing provider variables required by enabled
features; none of those secrets belong in the frontend project.

Redeploy the backend after saving the variables. Use the public production
domain for browser traffic. A Vercel login redirect or authentication challenge
on OPTIONS means Deployment Protection intercepted the request before Express.
Do not put Vercel bypass credentials in frontend code; keep preview protection
and use a public production domain.

## Frontend project (recommended same-origin mode)

Remove `VITE_API_URL` and `VITE_API_BASE_URL` from the frontend Vercel project's
Production environment. The checked-in `frontend/vercel.json` proxies
`/api/v1/*` to the stable backend production alias, and the checked-in
`.env.production` therefore leaves `VITE_API_URL` empty.

This is the default because browser requests remain on the frontend hostname.
The host-only HttpOnly refresh cookie is consequently first-party and is not
dependent on third-party-cookie permission. If the backend production alias
changes, update the API rewrite destination in `frontend/vercel.json` before
deploying.

`VITE_API_BASE_URL` is accepted as a backward-compatible alias, but never set
both names. Vite environment settings take precedence over `.env.production`.
For compatibility, a production API value whose hostname ends in `.vercel.app`
now resolves to the same-origin proxy in both the browser client and generated
security headers. An old Vercel setting therefore no longer fails the build or
restores direct cross-site API requests. Removing those obsolete values is still
recommended; the proxy destination remains defined in `frontend/vercel.json`.
Explicit custom API domains such as `https://api.getfit4u.in` remain supported,
and conflicting aliases or unsafe CSP origins still fail validation.
Local development uses `VITE_DEV_API_TARGET=http://localhost:5001`
(match the backend port) and Vite proxies browser requests through localhost:5173.

The client sends `credentials: "include"` and the `x-csrf-protection` header.
The backend permits those credentials and headers for configured origins; do
not replace its origin allowlist with `*`.

## Production cookie domain

As an alternative to the same-origin proxy, add `api.getfit4u.in` to the
**backend** project's
Domains, apply the DNS record shown by Vercel, and wait for HTTPS to be ready.
Then change the frontend's `VITE_API_URL` to `https://api.getfit4u.in` and rebuild.
Keep `COOKIE_DOMAIN` unset, keep the frontend origins in `CLIENT_ORIGIN`, and
remove `VITE_API_BASE_URL`.

`www.getfit4u.in` and the current `vercel.app` backend are different sites.
Production refresh cookies use Secure and SameSite=None, but browser third-party
cookie restrictions can still block them even after CORS is correct. The API
subdomain places the main website and API on the same site. Use the custom
frontend domain for production sessions; the old frontend alias is cross-site
with that API subdomain.

## Redeploy in the required order

1. Save the backend Production variables and redeploy the backend without using
   an old deployment-specific URL.
2. Confirm `https://git-fit4-u-un7d.vercel.app/health` returns JSON.
3. Remove both frontend API URL variables for same-origin mode, then redeploy
   the frontend so Vite cannot retain an old build-time value.
4. Clear site data once on the test device to remove cookies created under the
   previous cross-site architecture, then sign in again.
5. Do not rotate JWT secrets on routine redeploys. Rotating them intentionally
   invalidates access tokens; MongoDB-backed refresh sessions must continue to
   use the same stable database.

## Verify after redeployment

Open the production API's `/health`; it should return JSON. Then check a browser
preflight from the main website, without performing a login or database write:

```powershell
curl.exe -i -X OPTIONS "https://git-fit4-u-un7d.vercel.app/api/v1/auth/login" -H "Origin: https://www.getfit4u.in" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-csrf-protection"
```

Expect HTTP 204, `Access-Control-Allow-Origin: https://www.getfit4u.in`, and
`Access-Control-Allow-Credentials: true`. There should be no Vercel SSO redirect.
Use `https://api.getfit4u.in` in this check once that domain is configured.

In browser DevTools:

1. **Network**: the login URL should be
   `https://www.getfit4u.in/api/v1/auth/login` in same-origin mode. Its response
   must be JSON and include `Set-Cookie` for `gfu_refresh`.
2. **Application > Cookies**: `gfu_refresh` must be HttpOnly, Secure,
   SameSite=None, Path `/`, and have a future expiry. It must not appear in local
   or session storage.
3. **Application > Storage**: `gfu-has-session` is only a non-secret activity
   hint. Access tokens live in memory; neither local nor session storage should
   contain `gfu_access_token`.
4. **Network**: after reloading or reopening a protected route (also after clearing
   local/session storage while keeping cookies), `POST /api/v1/auth/refresh`
   must send the cookie, return 200, and be
   followed by `GET /api/v1/auth/me`.
5. Repeat refresh, navigation, new-tab, browser-reopen, and 20-minute idle tests
   for USER, GYM_OWNER, TRAINER, and ADMIN. A 500 or offline request must show an
   error/retry state without clearing the session; an expired/revoked refresh
   credential must redirect to login.

Chrome/mobile/incognito validation still depends on cookies being allowed for
the site. Same-origin mode avoids the third-party-cookie exception entirely.
These domain changes do not start Socket.IO or the background workers that
currently live in `backend/src/server.ts`.
