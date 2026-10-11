# PhonePe-only cutover report

Date: 2026-10-09

## Outcome

PhonePe Standard Checkout v2 is the only active online payment gateway in GETFIT4U. The frontend no longer loads a Razorpay checkout script, the backend no longer contains a Razorpay provider, and the retired browser verification and webhook routes are absent. There is no gateway selector or automatic fallback.

Platform subscription payments resolve the stable GETFIT4U merchant from `PHONEPE_MERCHANT_ID`. Gym membership online collection is deliberately disabled before payment creation until PhonePe supplies and approves the account-specific Marketplace/Split Settlement allocation contract. Authorized offline gym collection remains available.

## Removed active integration

- Razorpay provider/service and provider-only refund tests;
- frontend SDK loader, widget callback and browser signature verification;
- `POST /api/v1/checkout/verify`;
- `POST /api/v1/webhooks/razorpay`;
- active Razorpay order, status, webhook and refund branches;
- Razorpay environment variables, frontend key and CSP/network origins;
- deployment/provider selector behavior and fallback paths.

`npm ls razorpay --all` returns an empty dependency tree. The production frontend bundle contains no Razorpay or Razorpay-domain text.

## PhonePe implementation

- Server-side Standard Checkout v2 OAuth token acquisition and scoped caching;
- hosted checkout creation with an allowlisted GETFIT4U return route;
- authenticated payment status polling with a database cooldown;
- SHA-authenticated raw-body webhook endpoint at `/api/v1/webhooks/phonepe`;
- durable event inbox before processing, duplicate concurrency handling and event-ID/payload replay rejection;
- server-to-server Order Status validation for merchant context, order and amount;
- idempotent transactional entitlement/invoice fulfillment;
- PhonePe refund submission and reconciliation;
- separate payment, entitlement, allocation, settlement and refund states;
- PhonePe connection/onboarding screens for Gym Owners and Admins, storing provider references and masked settlement details only.

HMAC webhook mode is fail-closed until PhonePe provides the exact account contract or official verifier.

## Historical preservation and migration

The `RAZORPAY` enum value remains only for historical financial facts. Historical order/payment references, invoices, entitlements, amounts and provider labels are not rewritten. A historical Razorpay refund returns `LEGACY_REFUND_EXTERNAL_ACTION_REQUIRED` and must be handled through the original provider's controlled operations process with retained evidence.

`npm run db:migrate-phonepe-payments` is an additive, operator-controlled migration. It backfills neutral flow/environment/scoped identifiers and provider-scoped indexes without changing the historical provider. It was not run automatically against the configured database.

The read-only `npm run db:inspect-payment-cutover` result was:

- no application payments in CREATED, PENDING, AUTHORIZED, REFUND_PENDING or DISPUTED states;
- no unresolved application refunds;
- no unsettled settlement records;
- no unprocessed provider events;
- 4 captured offline membership payments;
- 8 captured historical Razorpay membership payments and 3 cancelled historical membership attempts;
- 5 captured historical Razorpay platform payments;
- 9 active gym memberships and 3 active platform subscriptions.

Provider-dashboard facts are outside MongoDB. Operations must still confirm disputes, issued payment links, unsettled provider transfers and any real recurring mandates before removing old account access or secrets.

## Business routing

### Platform subscription

Owner -> server-priced platform quote -> GETFIT4U merchant snapshot -> PhonePe hosted checkout -> authenticated webhook/status reconciliation -> captured payment -> platform entitlement and invoice.

### Gym membership

Member -> server-priced gym quote -> exact approved gym beneficiary -> provider allocation -> PhonePe checkout -> captured payment -> membership and gym invoice.

The second flow remains blocked at beneficiary validation because the real PhonePe allocation contract is not available. GETFIT4U does not collect that money into its own merchant and does not fabricate a vendor allocation. GETFIT4U membership commission is represented as zero in the future beneficiary snapshot, but no live allocation claim is made.

## Verification results

- Backend full unit suite: 102 files, 773 tests passed.
- Frontend full unit/component suite: 91 files, 597 tests passed.
- Targeted payment suites: 5 backend files/43 tests and 2 frontend files/26 tests passed.
- Isolated registration/payment lifecycle: 125 checks passed; no real charge.
- Isolated broader integration: 102 checks passed.
- Isolated enhancement regression: 51 workflow groups passed.
- Isolated platform offers/payment capture: passed.
- Backend TypeScript build: passed.
- Backend Vercel semantic TypeScript check: passed.
- Frontend TypeScript/Vite production build: passed (2,970 modules).
- Backend and frontend ESLint: passed with zero warnings.
- Backend and frontend production dependency audits: 0 reported vulnerabilities.
- `git diff --check`: passed; line-ending notices are informational.
- Secret-pattern scan: no payment/API token patterns; one Firebase documentation PEM marker example only.

These are automated and simulated results. No real PhonePe charge, refund, vendor allocation or bank settlement was performed.

## Deployment and rollback

1. Back up MongoDB and record the cutover timestamp.
2. Complete the external provider-dashboard inventory.
3. Apply the additive payment migration in a maintenance window.
4. Configure the exact environment's PhonePe server credentials and SHA webhook.
5. Verify sandbox platform checkout, duplicate webhooks, return recovery and refund.
6. Perform an explicitly authorized low-value production platform payment and verify bank evidence.
7. Keep membership online collection disabled until PhonePe certifies two distinct gym beneficiaries, zero platform commission allocation, refunds/reversals and settlement reporting.
8. Remove legacy secrets only after every historical obligation has an assigned operations process.

Rollback pauses new PhonePe checkout and reconciles known PhonePe order IDs. It never sends an in-flight PhonePe purchase to Razorpay and never silently restores a removed gateway.

## External blockers

1. PhonePe must enable Marketplace/Split Settlements on the GETFIT4U account and supply the exact allocation/refund/reversal contract.
2. Gym A and Gym B vendor onboarding and real settlement evidence are still required.
3. Original-provider dashboard inventory and responsibility for historical disputes, links, transfers, mandates and refunds remain an operator task.
4. Real-device/provider acceptance has not been executed in this implementation session.
