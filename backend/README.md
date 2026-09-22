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

## Production prerequisites

- MongoDB Atlas cluster with a geospatial index-capable tier
- Redis for queues, throttling coordination, projections, and scheduled work
- HTTPS Node/container runtime and `api.getfit4u.in` DNS
- Razorpay keys and webhook secret
- Google OAuth client ID
- MSG91 and WhatsApp Business credentials
- S3-compatible object storage for private documents and public gym media

No payment credential, OTP, complete bank account, or raw sensitive audit value should be logged or stored. Provider webhooks remain authoritative for payment activation.
