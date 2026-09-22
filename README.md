# GETFIT4U — Gym Management & Fitness Platform

Production-oriented TypeScript MERN implementation of the approved GETFIT4U Figma system. It contains the responsive public/member application, Gym Owner, Trainer and Admin workspaces plus a versioned REST API.

## Stack and folders

- `frontend/`: React 19, Vite, React Router, TanStack Query, React Hook Form, Zod, Socket.IO client and vanilla CSS.
- `backend/`: Express 5, Mongoose, JWT/refresh sessions, Socket.IO, BullMQ-ready Redis integration and Pino.
- `docs/`: screen inventory, architecture, feature traceability, flows, API, database, integrations, security, testing and final QA.

## Start locally in VS Code

1. Install Node.js 22+, Docker Desktop and VS Code.
2. Open this `getfit4u` folder in VS Code.
3. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`.
4. Start infrastructure: `docker compose up -d mongo redis`.
5. Backend terminal: `cd backend`, `npm ci`, `npm run seed`, `npm run dev`.
6. Frontend terminal: `cd frontend`, `npm ci`, `npm run dev`.
7. Open `http://localhost:5173`; API health is `http://localhost:5000/health`; development Swagger is `http://localhost:5000/api-docs`.

The seed password for `admin@getfit4u.in` and `trainer@getfit4u.in` is `GetFit4U123`. It is development data only and must never be reused in production.

## Architecture and database

The browser calls `/api/v1`. Access tokens are short-lived; refresh tokens are rotated in HttpOnly cookies and can be revoked per device. Backend middleware enforces role, permission and active gym context. MongoDB is the source of record; tenant records carry `gymId`; geospatial gym queries use GeoJSON `[longitude, latitude]`. See `docs/architecture.md` and `docs/database-schema.md`.

## Payments

Configure Razorpay test keys and point its webhook to `/api/v1/webhooks/razorpay`. Checkout success only verifies the checkout signature; membership activation occurs from a verified capture/order-paid webhook after amount and currency checks. Refunds are initiated by Admin through the provider abstraction.

## Maps and attendance

Restrict the browser maps key by domain and API. Keep the backend key server-restricted. Member QR tokens are HMAC-signed, gym-scoped and expire in 30–120 seconds. The scanner validates active membership, token nonce, duplicate cooldown, GPS accuracy and gym radius on the server.

## Messaging and notifications

REST persists conversations/messages and Socket.IO delivers new messages, typing and read receipts. A socket can join only conversations containing the authenticated user. Configure Firebase service-account variables for push; in-app notifications work independently. WhatsApp uses the Cloud API template endpoint and requires approved templates and consent.

## Files

Uploads use short-lived S3-compatible presigned URLs. The API validates MIME type/size, creates randomized tenant/user keys, verifies object existence on completion and authorizes deletion. Configure the `OBJECT_STORAGE_*` variables.

## Commands

```bash
cd backend
npm run build
npm test
npm run seed

cd ../frontend
npm run build
npm test
```

## Production

Use a MongoDB replica set, managed Redis, TLS, strong independent secrets, an explicit CORS allowlist and provider live credentials stored in the deployment secret manager. Build `frontend` and serve `dist/` through a CDN. Run `backend/dist/server.js` behind a health-aware load balancer. Multiple API instances require a Redis Socket.IO adapter and separate BullMQ workers.

## Troubleshooting

- `API_NOT_CONFIGURED`: set `VITE_API_URL=http://localhost:5000`.
- Mongo connection failure: confirm Docker is running and `MONGO_URI` matches `docker-compose.yml`.
- Payment/maps/push/upload unavailable: supply the corresponding variables; the API deliberately refuses to simulate provider success.
- Transaction error during checkout/class booking: use a MongoDB replica set in production/test integration environments.
- Browser session loops: clear site cookies/session storage, then log in again.

See `docs/environment-variables.md` for every variable and `docs/final-qa-report.md` for verified scope and credential-dependent limitations.
