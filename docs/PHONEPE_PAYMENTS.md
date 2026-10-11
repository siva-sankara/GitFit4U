# GETFIT4U PhonePe payment architecture

## Current production-safe state

PhonePe is the only active online gateway in the application.

- `PLATFORM_SUBSCRIPTION`: a Gym Owner pays an Admin-created GETFIT4U plan through PhonePe Standard Checkout v2. The server always selects the configured GETFIT4U merchant.
- `GYM_MEMBERSHIP`: the server resolves a versioned gym payment connection, but online collection is fail-closed until PhonePe supplies and enables GETFIT4U's account-specific Marketplace/Split Settlement allocation contract. The application does not collect a gym's money into the platform merchant.
- Authorized offline membership collection remains available.
- Historical Razorpay and offline records keep their original provider, order/payment references, invoices, entitlements and audit evidence. No active Razorpay SDK, checkout, webhook, order, reconciliation or refund execution remains.

A gym ID, bank record or vendor reference stored in GETFIT4U is not by itself a provider settlement instruction. The public Standard Checkout v2 create-payment contract does not publish the required vendor-allocation fields, so GETFIT4U does not invent them.

## Required server environment

```dotenv
PHONEPE_ENV=sandbox
PHONEPE_CLIENT_ID=
PHONEPE_CLIENT_SECRET=
PHONEPE_CLIENT_VERSION=
PHONEPE_MERCHANT_ID=
PHONEPE_MARKETPLACE_ENABLED=false

PHONEPE_WEBHOOK_AUTH_MODE=sha
PHONEPE_WEBHOOK_USERNAME=
PHONEPE_WEBHOOK_PASSWORD=
```

There is no payment-provider selector and no Razorpay configuration. Do not expose any payment credential through a `VITE_` variable. Production also requires an HTTPS `CLIENT_ORIGIN`.

## PhonePe dashboard setup

1. Obtain Standard Checkout v2 Client ID, Client Secret, Client Version and Merchant ID for the correct sandbox or production environment.
2. Configure callback URL `https://<api-host>/api/v1/webhooks/phonepe`.
3. Subscribe to `checkout.order.completed`, `checkout.order.failed`, `pg.refund.completed` and `pg.refund.failed`.
4. For the implemented SHA mode, configure the same webhook username/password in PhonePe and the server environment. GETFIT4U timing-safely compares the documented SHA-256 credential value.
5. GETFIT4U durably records each accepted event before processing, rejects event-ID/payload mismatches, and queries PhonePe Order Status server-to-server before applying payment facts or entitlements.

HMAC mode is fail-closed. Enable it only after PhonePe supplies the exact account contract or official verifier, including the primitive, canonical input, header and encoding. The application does not guess financial signature algorithms.

## Gym onboarding and external blocker

Gym Owners submit payment-account details under **Gym Profile Settings -> Payment account**. GETFIT4U stores provider references and masked settlement data, not full provider credentials. Admins may record provider evidence under **Payment onboarding**, but an Admin approval cannot create provider capability.

Member online payment requires all of the following:

- Marketplace/Split Settlements enabled on the GETFIT4U PhonePe contract;
- a PhonePe-approved vendor/sub-merchant for the exact gym;
- collection, allocation, reversal, refund and settlement capabilities confirmed by PhonePe;
- the account-specific allocation request/response contract implemented with the full applicable member amount assigned to one gym and GETFIT4U commission recorded as zero;
- sandbox certification for two distinct gym beneficiaries, followed by explicitly authorized low-value production settlement tests.

Until PhonePe supplies that contract, `PHONEPE_MARKETPLACE_ENABLED` must remain `false`. Even setting it to `true` does not bypass the contract blocker. Membership checkout returns `GYM_ONLINE_PAYMENT_UNAVAILABLE`; no payment attempt is created and no fallback gateway is used.

## Runtime behavior

- Amounts use integer paise and INR; PhonePe checkout requires at least 100 paise.
- OAuth tokens are cached by environment, client ID and client version, then refreshed before expiry.
- The hosted checkout return route stores only the GETFIT4U payment public ID and polls the authenticated API. URL parameters never mark a payment paid.
- Provider payment, entitlement fulfillment, beneficiary allocation, bank settlement and refund are independent statuses.
- PhonePe refunds use the original PhonePe merchant order reference and are reconciled to a final provider state.
- Historical Razorpay refunds are never sent to PhonePe. Support/Admin must use the original provider's controlled dashboard or a separately authorized operations service, retain evidence, and reconcile an audited adjustment. The application intentionally returns `LEGACY_REFUND_EXTERNAL_ACTION_REQUIRED`.

## Data migration and cutover

1. Back up MongoDB and record the release/cutover timestamp.
2. Inventory pending/authorized payments, processing refunds, unsettled transfers, disputes, payment links and any real recurring mandates in the original provider dashboard. The repository cannot prove external account state.
3. Deploy the PhonePe-only code with new online checkout paused if unresolved old attempts exist. Never charge the same intended purchase twice.
4. Run `npm run db:migrate-phonepe-payments` from `backend/` once in a maintenance window. It backfills neutral flow/environment/scoped keys without changing provider identity, amount, invoice or entitlement, and creates provider-scoped indexes.
5. Configure the PhonePe sandbox credentials/webhook and test platform subscription checkout, return recovery, duplicate webhooks, status polling and refunds.
6. Perform explicitly authorized production platform-payment verification. Sandbox success is not bank-settlement evidence.
7. Keep gym membership online collection disabled until the Marketplace contract and beneficiary certification above are complete.
8. Remove old Razorpay deployment secrets only after operations confirms all legacy refunds, disputes, transfers, links and mandates have an owner and documented process.

Rollback never re-enables Razorpay. Pause affected new PhonePe checkout, preserve in-flight PhonePe identifiers, continue status/webhook reconciliation, and repair or redeploy the PhonePe implementation. Do not submit an existing PhonePe purchase to another gateway.

Official references: [Authorization](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization), [Create Payment](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment), [Order Status](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status), [Refund](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/refund), [Webhook](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook), [Marketplace](https://business.phonepe.com/marketplace-payment-gateway), [Split Settlements](https://business.phonepe.com/split-settlements).
