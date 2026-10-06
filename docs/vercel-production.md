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
CLIENT_ORIGIN=https://www.getfit4u.in,https://git-fit4-u.vercel.app
COOKIE_DOMAIN=
```

Remove `COOKIE_DOMAIN` if the dashboard does not accept an empty value. This
creates a cookie scoped to the API hostname. Keep `www.getfit4u.in` first in
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

Redeploy the backend after saving the variables. Use the public production
domain for browser traffic. A Vercel login redirect or authentication challenge
on OPTIONS means Deployment Protection intercepted the request before Express.
Do not put Vercel bypass credentials in frontend code; keep preview protection
and use a public production domain.

## Frontend project

In Settings → Environment Variables → **Production**, set:

```dotenv
VITE_API_URL=https://git-fit4-u-un7d.vercel.app
```

Use the API origin only, without `/api/v1`, `/health`, or a trailing slash. The
code adds endpoint paths itself. Remove or update any older value pointing to
localhost or a deployment-specific URL. The checked-in `frontend/.env.production`
provides this public value for production builds, but a Vercel environment
variable takes precedence. The local development `.env` remains separate.

Redeploy the frontend after changing `VITE_API_URL`: Vite embeds it in JavaScript
at build time. The existing client already sends `credentials: "include"` and
the `x-csrf-protection` header. The backend already permits those credentials and
headers for configured origins; do not replace its origin allowlist with `*`.

## Production cookie domain

For reliable browser sessions, add `api.getfit4u.in` to the **backend** project's
Domains, apply the DNS record shown by Vercel, and wait for HTTPS to be ready.
Then change the frontend's `VITE_API_URL` to `https://api.getfit4u.in` and rebuild.
Keep `COOKIE_DOMAIN` unset and keep the frontend origins in `CLIENT_ORIGIN`.

`www.getfit4u.in` and the current `vercel.app` backend are different sites.
Production refresh cookies use Secure and SameSite=None, but browser third-party
cookie restrictions can still block them even after CORS is correct. The API
subdomain places the main website and API on the same site. Use the custom
frontend domain for production sessions; the old frontend alias is cross-site
with that API subdomain.

## Verify after redeployment

Open the production API's `/health`; it should return JSON. Then check a browser
preflight from the main website, without performing a login or database write:

```powershell
curl.exe -i -X OPTIONS "https://git-fit4-u-un7d.vercel.app/api/v1/auth/login" -H "Origin: https://www.getfit4u.in" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-csrf-protection"
```

Expect HTTP 204, `Access-Control-Allow-Origin: https://www.getfit4u.in`, and
`Access-Control-Allow-Credentials: true`. There should be no Vercel SSO redirect.
Use `https://api.getfit4u.in` in this check once that domain is configured.

In browser DevTools, confirm that API requests use the selected API hostname,
that responses are JSON, and that a real test login can refresh its session.
These domain changes do not start Socket.IO or the background workers that
currently live in `backend/src/server.ts`.
