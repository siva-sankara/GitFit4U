# GETFIT4U frontend

Responsive React + TypeScript application for gym discovery, memberships, attendance, Gym Owner operations, and platform administration. Styling is vanilla CSS with shared tokens and responsive layouts; no CSS framework is used.

## Run locally

```bash
cp .env.example .env
npm ci
npm run dev
```

Set `VITE_API_URL` to the public origin of the GETFIT4U Express API. When it is omitted, the deployed experience runs as an interaction-rich approved-requirements preview with seeded demonstration data.

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
