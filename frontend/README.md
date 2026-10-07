# GETFIT4U frontend

Responsive React + TypeScript application for gym discovery, memberships, attendance, Gym Owner operations, and platform administration. Styling is vanilla CSS with shared tokens and responsive layouts; no CSS framework is used.

## Run locally

```bash
cp .env.example .env
npm ci
npm run dev
```

Set `VITE_DEV_API_TARGET` to the Express API origin for local development
(for example, `http://localhost:5001` when the backend uses `PORT=5001`). Open
`http://localhost:5173`. Vite proxies `/api` and `/socket.io` to that target;
the browser uses its own origin for API calls and refresh cookies. Restart Vite
after changing these settings. The backend must allow that frontend address in
`CLIENT_ORIGIN`; the proxy preserves Origin and CSRF checks.

Production leaves `VITE_API_URL` empty and uses the same-origin `/api/v1` proxy
in `vercel.json`. `VITE_API_BASE_URL` is a supported legacy alias. In development,
these variables are accepted as proxy targets if `VITE_DEV_API_TARGET` is unset.
Vercel project variables override the checked-in file;
see
[production domain setup](../docs/vercel-production.md) for the exact settings.

## Verify

```bash
npm run build
```

The generated `dist/` directory is the static deployment output. `_redirects` provides SPA routing, while `_headers`, the web manifest, and service worker provide browser security defaults and installable/offline-shell behavior.

## Major routes

- `/`, `/explore`, `/gyms/:slug` — public discovery and gym detail
- `/auth/login`, `/register-gym` — secure login and owner onboarding
- `/app/*` — member mobile-first workspace
- `/owner/*` — Gym Owner operations
- `/admin/*` — platform administration and monitoring
