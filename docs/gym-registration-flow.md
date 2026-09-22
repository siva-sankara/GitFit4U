# Gym registration: activation after verified payment

## Owner flow

1. Save gym name, contact details, full address and entrance coordinates. Existing location search, current location, editable address fields and Google Maps pin links remain available.
2. Select an active registration plan configured by the admin. The backend calculates and snapshots the amount and currency; client-supplied prices are ignored. Plans must cost at least 100 minor units (INR 1 for INR plans).
3. Review the selected plan, configured member/staff limits, access duration, and currency-correct price breakdown, then choose **Pay with Razorpay**. This is a one-time payment for the displayed period, not a recurring debit mandate. Checkout receives the plan name and the signed-in purchaser's name, email and phone from the backend. Failed or closed checkout can resume the same provider order and quoted price. Once an order exists, its plan remains fixed so switching plans cannot create a second charge. An existing order can still be retried if its plan is subsequently disabled. An expired quote refreshes the displayed price and asks the owner to confirm payment again. Razorpay script loading times out after 15 seconds with a retryable error before creating an order.
4. The server validates the checkout HMAC and fetches the payment directly from Razorpay, checking the payment ID, order ID, amount, currency and `captured` status. Signed capture webhooks also complete the flow if the browser closes or the client callback is lost.
5. Payment capture, platform subscription creation, registration activation and gym publication commit together in a MongoDB transaction. The page refreshes payment/registration status and displays the active gym and owner workspace link. There are no registration documents or manual approval steps.

A failed, pending or cancelled payment does not publish a gym. A valid late capture can complete a previously cancelled checkout; cancellation only records dismissal and is not a gateway refund. Duplicate callbacks and simultaneous capture events reuse the existing transaction result. Late failure or cancellation cannot downgrade a captured payment. Moderation suspension/archive remains available and cannot be bypassed by delayed payment.

## API and dashboard changes

- `/api/v1/owner/registrations` creates or resumes an inactive draft, preserving the owner's current session role.
- `PATCH /api/v1/owner/registrations/:id` edits saved details; an in-progress order must finish or be closed before editing.
- The compatibility `POST /api/v1/owner/registrations/:id/submit` only validates details and continues to plan selection.
- `GET /api/v1/workspace/platform-plans` lists available paid plans; the admin continues managing plans and pricing in the platform plans workspace.
- `POST /api/v1/checkout/platform/quotes` and `/platform/orders` use server-owned prices and retry an existing order.
- `POST /api/v1/checkout/verify` validates the signature and gateway payment status. `POST /api/v1/checkout/payments/:id/cancel` records checkout dismissal for the authenticated purchaser.
- `GET /api/v1/checkout/payments/:id` also reconciles a pending/authorized payment when its gateway payment ID has already been recorded through a signed callback or gateway event. It checks Razorpay's payment ID, order, amount, currency and capture status before activation, with an atomic 15-second cooldown per payment. This recovers delayed capture without another browser callback. Webhooks remain required to recover payments when the browser never submits its callback.
- Admin registration details show payment records. The registration review endpoint and review controls have been removed. Resuming a suspended gym still requires a captured registration payment and valid platform subscription.
- Public listing, nearby search, details, classes and membership checkout no longer depend on document verification. Publication requires `Gym.status=ACTIVE` and `platformSubscriptionStatus=ACTIVE`.
- Uploads with `registrationId` are rejected with HTTP 410. Other upload features are preserved. Existing document objects and review history are retained.

## Required configuration

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`, then restart the backend. Match test keys to test-mode webhooks or live keys to live-mode webhooks. Configure automatic payment capture and deliver `payment.captured`, `order.paid`, and `payment.failed` to the public HTTPS `/api/v1/webhooks/razorpay` endpoint with the matching webhook secret. MongoDB must support transactions (Atlas or a replica set).

The inspected API keys use test mode. The webhook secret is still absent, so the application intentionally reports payments unavailable. Create a test-mode webhook in the Razorpay dashboard, enter its matching secret in `backend/.env`, and restart. For local development the webhook needs a public HTTPS address forwarding to the backend; a localhost URL is not reachable by Razorpay. Do not place the API key secret or webhook secret in frontend environment variables. After setup, use a Razorpay test-mode checkout and confirm delivery of the capture event in the dashboard. No additional data migration is needed for the delayed-capture polling field; existing records acquire it on their first eligible status check.

Storage credentials and S3 permissions are no longer registration prerequisites. `LOCATIONIQ_API_KEY` is only needed for map tiles/address lookup; device coordinates and pasted map coordinates remain available without it.

Razorpay references: [checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [payment webhooks](https://razorpay.com/docs/webhooks/payments/), and [duplicate/out-of-order webhook handling](https://razorpay.com/docs/webhooks/validate-test/).

## Existing records and migration

From `backend`, inspect the proposed changes:

```powershell
npm run db:migrate-registration
```

Apply them after inspection:

```powershell
npm run db:migrate-registration -- --apply
```

The migration is repeatable and preserves existing active gym records without rewriting their profile, publication date or subscription flags. Suspended and archived gyms remain unchanged. Legacy unpaid registration states become drafts ready for plan selection. A legacy payment-success or approval label alone never activates a gym.

An inactive legacy gym is activated only when its captured payment, active subscription, immutable quote and processed capture event match the same registration, owner, gym, amount, currency, provider order and payment ID. Ambiguous or expired payment records stay inactive for reconciliation. Legacy enum values and review history remain readable for compatibility; they no longer grant approval or publication.

## Verification

Run both application builds and unit suites, then `npm run test:registration` from `backend`. That lifecycle test uses a uniquely named temporary MongoDB database and simulated gateway responses; it removes its test database afterward. It covers successful capture, forged signatures, mismatched amounts/currencies/orders, authorization without capture, payment failure, cancellation, retries, duplicate/concurrent callbacks, visibility, moderation and conservative migration. `npm run test:integration` covers unrelated member and owner workflows.

These tests do not make real charges or certify delivery from a live Razorpay dashboard. A provider test-mode payment and webhook delivery check are required when deploying with actual credentials.

Latest verification: both production builds passed, with 33 frontend tests, 23 backend unit tests, 123 payment registration/migration checks and 81 broader integration checks. The inspected migration was previously applied to the configured database: one active gym was preserved, one unpaid legacy registration became a draft, and no gyms were activated. It was not rerun for this checkout enhancement. `RAZORPAY_WEBHOOK_SECRET` was absent during the configuration check; add the matching gateway webhook secret before checkout can be enabled.
