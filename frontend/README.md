# GETFIT4U frontend

Responsive React + TypeScript application for gym discovery, memberships, attendance, Gym Owner operations, and platform administration. Styling is vanilla CSS with shared tokens and responsive layouts; no CSS framework is used.

## Run locally

```bash
cp .env.example .env
npm ci
npm run dev
```

Set `VITE_API_URL` to the Express API origin for local development. Production
leaves it empty and uses the same-origin `/api/v1` proxy in `vercel.json`, which
keeps the refresh cookie first-party. `VITE_API_BASE_URL` is a supported legacy
alias; set only one name. Vercel project variables override the checked-in file;
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
