# GETFIT4U API

Node.js, Express, TypeScript, MongoDB/Mongoose API for the GETFIT4U fitness platform. It implements OTP and Google identity, rotating sessions, role/gym-scoped authorization, public gym discovery, owner onboarding and management, member/subscription/attendance operations, payment orchestration, webhooks, campaigns, approvals, audit logs, and monitoring endpoints.

## Run locally

```bash
cp .env.example .env
npm ci
npm run seed
npm run dev
```

MongoDB and Redis must be available at the values in `.env`. Use long, independent JWT secrets outside local development.

## Verify and package

```bash
npm test
npm run build
docker build -t getfit4u-api .
```

## Vercel TypeScript builds

Set the Vercel project's **Root Directory** to `backend` (relative to the
GitFit4U repository root). The `vercel.json` in this directory sets the install
command to `npm ci --include=dev`, so TypeScript and `@types/node` are installed
even when `NODE_ENV=production` or npm's omit setting excludes development
dependencies. Both packages are already declared in `devDependencies` and the
lockfile.

Vercel's TypeScript 7 transpiler creates a temporary `tsconfig.json` outside the
project that extends this backend's config. Without an explicit type root,
compiling through that temporary config can report
`TS2688: Cannot find type definition file for 'node'` even when the package is
installed and `npm run build` passes. Keep both settings in `tsconfig.json`:

```json
"typeRoots": ["./node_modules/@types", "./src/types"],
"types": ["node", "express-request"]
```

The relative `typeRoots` path stays anchored to the backend config when inherited.
The local `express-request` type package explicitly loads `src/types/express.d.ts`,
which adds `auth`, `requestId`, and `idempotencyKey` to Express requests. Vercel's
temporary config also replaces `include` and `files`, so these declarations must
be loaded through `types` rather than relying on `include` alone.

Check both the regular build and Vercel's temporary-config compilation locally:

```bash
npm run build
npm run test:vercel-types
```

The second command enables full type checking and compiles from `src/server.ts`
through a temporary config outside the project. It does not start the server or
connect to any services.

After pushing these configurations, redeploy without the existing build cache.
Confirm that the installation log shows `npm ci --include=dev`.

## Vercel runtime

Vercel loads `src/app.ts` directly. Keep its default Express export as well as the
named `app` export used by `src/server.ts`. A named export alone causes
`Invalid export found in module` and `500 FUNCTION_INVOCATION_FAILED` on every
request even after a successful build.

`GET /health` returns a liveness response without requiring MongoDB. API requests
under `/api/v1` (including the payment webhook) await a shared MongoDB connection
before running their handlers. Set `MONGO_URI` and the other production variables
in Vercel's environment settings. A healthy `/health` response does not verify
database access. `/` and `/favicon.ico` have no routes and return the API's normal
404 JSON response; the backend does not serve the frontend website.

The standalone `src/server.ts` also starts Socket.IO and recurring maintenance/
push delivery. Those processes are not started by Vercel's `app.ts` entry point;
running the HTTP API alone does not provide them. They need a separately running
server/worker or a dedicated adaptation to the deployment platform.

## Production prerequisites

- MongoDB Atlas cluster with a geospatial index-capable tier
- Redis for queues, throttling coordination, projections, and scheduled work
- HTTPS Node/container runtime and `api.getfit4u.in` DNS
- Razorpay keys and webhook secret
- Google OAuth client ID
- MSG91 and WhatsApp Business credentials
- S3-compatible object storage for private documents and public gym media

No payment credential, OTP, complete bank account, or raw sensitive audit value should be logged or stored. Provider webhooks remain authoritative for payment activation.
