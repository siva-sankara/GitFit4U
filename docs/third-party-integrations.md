# Third-party Integrations

| Provider | Purpose | Server responsibility | Credential blocker behavior |
|---|---|---|---|
| Razorpay | Membership/platform payments, refunds | Create order, verify checkout signature/webhook, reconcile and refund | Endpoint returns `PAYMENT_PROVIDER_NOT_CONFIGURED`; no fake paid state |
| LocationIQ | Address search, forward/reverse geocoding, map tiles, driving/walking routes | Proxy requests with a server-only key; normalize addresses and coordinates | Device location and pasted coordinates remain available; geofence uses measured device coordinates |
| Firebase Cloud Messaging | Web push | Register/revoke device tokens, send data notification | In-app notifications continue; push records failure |
| WhatsApp Cloud API | Templates and broadcasts | Consent, templates, rate limits, delivery callbacks | Campaign remains blocked/failed with actionable provider status |
| S3-compatible storage | Photos, documents, attachments | Presigned upload, MIME/size policy, authorization, deletion | Upload endpoint returns unavailable; no binary stored in MongoDB |
| Redis/BullMQ | Jobs, rate controls, Socket.IO scale | Campaign/reminder/retry queues and pub/sub | Single-instance realtime can run; scheduled jobs require Redis |

All providers are behind interfaces in `backend/src/integrations`. Webhooks use raw request bodies, signature verification and dedupe keys.
