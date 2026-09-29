# Environment Variables

## Backend

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV`, `PORT` | Yes | Runtime mode and HTTP port |
| `MONGO_URI` | Yes | MongoDB replica-set connection in production |
| `CLIENT_ORIGIN` | Yes | Comma-separated CORS allowlist |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Yes | Independent strong signing secrets |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Yes | Token lifetimes |
| `COOKIE_DOMAIN` | Optional | Leave unset for a host-only refresh cookie; never set a frontend domain on an unrelated API domain |
| `REDIS_URL` | Jobs/scale | BullMQ and Socket.IO adapter |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments | Razorpay test/live credentials |
| `GOOGLE_CLIENT_ID` | OAuth | Google sign-in audience |
| `LOCATIONIQ_API_KEY` | Address search, maps and routes | Server-only LocationIQ token; never expose through a `VITE_` variable |
| `LOCATIONIQ_REGION` | Optional | `us1` (default) or `eu1` for geocoding and routing |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Push | FCM service account |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` | WhatsApp platform sender | Optional platform Cloud API bootstrap assets; server-only |
| `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp | Embedded Signup, signed webhook processing and callback verification; server-only |
| `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` | WhatsApp onboarding | Public Meta configuration ID returned only to an authenticated setup screen |
| `WHATSAPP_COEXISTENCE_ENABLED`, `WHATSAPP_COEXISTENCE_CONFIG_ID` | WhatsApp Coexistence | Feature flag (default false) and optional Embedded Signup v4 Business App onboarding configuration ID |
| `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY` | WhatsApp | Independent server-only key used to encrypt tenant access tokens at rest |
| `WHATSAPP_API_VERSION`, `WHATSAPP_DEFAULT_LANGUAGE`, `WHATSAPP_WEBHOOK_RETENTION_DAYS`, `WHATSAPP_WORKER_ENABLED` | WhatsApp operations | Version pin, defaults, retention and dedicated-worker controls |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_REGION` | Uploads | S3-compatible storage |
| `LOG_LEVEL` | Yes | Structured log threshold |

## Frontend

`VITE_API_URL`, `VITE_FIREBASE_*`, `VITE_RAZORPAY_KEY_ID`. Only public browser identifiers use the `VITE_` prefix; secrets never do. LocationIQ requests, including map tiles, go through the backend. The legacy Google Maps key entries are commented out; Google sign-in configuration is independent. See [LocationIQ setup](locationiq-integration.md).


MSG91 OTP delivery also requires `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`. Payment checkout receives its public key from the backend order response. `VITE_API_URL` contains the backend origin; `CLIENT_ORIGIN` contains the allowed frontend origins. Credentialed cookies require appropriate HTTPS/domain settings. Redis configuration alone does not enable a distributed worker or Socket.IO adapter. See [Vercel production setup](vercel-production.md) for the current domain values.
