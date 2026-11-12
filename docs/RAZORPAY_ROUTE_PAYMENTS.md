# Razorpay and Razorpay Route payments

## Active model

Razorpay is the only gateway used for new online payments. Historical provider
identities remain readable for audit and external reconciliation, but they are
never selected as a fallback.

Two purchase purposes are intentionally separate:

- `PLATFORM_PLAN`: a standard Razorpay Order belonging to GETFIT4U. It has no
  gym transfer.
- `MEMBERSHIP`: an INR Razorpay Order with exactly one order-level Route
  transfer to the selected gym's server-resolved linked account. The transfer
  equals the customer-paid amount and GETFIT4U commission is zero.

The member browser cannot submit a linked-account ID, transfer amount,
commission, provider environment, or settlement destination. The committed
payment stores an immutable beneficiary snapshot and mapping version before
Razorpay Checkout opens.

## Required configuration

```dotenv
PAYMENT_PROVIDER=razorpay
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_ROUTE_ENABLED=false
RAZORPAY_SUBSCRIPTIONS_ENABLED=false
RAZORPAY_GYM_FEE_BEARER=platform_absorbs
```

`RAZORPAY_MODE` must match the Key ID prefix. The Route flag is an application
rollout control, not proof of provider approval. Do not set it to true in live
mode until Razorpay has explicitly enabled Route for the GETFIT4U merchant and
the approved fee policy and funding requirements are documented.

`platform_absorbs` is the only implemented live-capable gym fee policy. It
transfers the full customer-paid membership amount to the linked account;
GETFIT4U must fund applicable gateway/Route fees and taxes. The
`gym_deducts_actual` value deliberately blocks collection because authoritative
account-specific fee calculation has not been implemented. No customer
surcharge is added.

Ordinary one-time checkout never creates a recurring mandate. Keep
`RAZORPAY_SUBSCRIPTIONS_ENABLED=false` until a separately reviewed recurring
Route allocation design is certified.

## Razorpay setup

1. Activate the GETFIT4U Razorpay merchant and obtain separate test and live
   API keys.
2. Ask Razorpay to assess and explicitly enable Route for GETFIT4U's payer-
   payee model. Complete the required supplier declarations and commercial
   agreement.
3. Configure automatic capture consistently for Orders. The backend also sends
   `payment_capture=1` and never grants access on an authorized-only payment.
4. Create separate webhook configurations for test and live environments:
   `https://<api-host>/api/v1/webhooks/razorpay`.
5. Use an independently generated webhook secret. Subscribe to payment/order,
   refund, Route transfer/reversal, and settlement events available on the
   merchant account. The endpoint verifies `X-Razorpay-Signature` over the
   exact raw bytes and deduplicates `x-razorpay-event-id`.
6. For each gym, complete Razorpay's supported linked-account and Route product
   onboarding. GETFIT4U does not submit PAN or bank changes automatically.
   This avoids unauthorized KYC mutations and duplicate accounts.
7. In Gym Profile Settings, the authorized owner records the business identity
   and accepts the beneficiary terms. In Admin > Gym payment onboarding, an
   authorized finance operator enters the provider-returned `acc_...` linked
   account and `acc_prd_...` Route product IDs.
8. Approval fetches both resources directly from Razorpay. It requires a Route
   account in `created` state, an `activated` Route product, accepted provider
   terms, no unresolved product requirements, and a matching legal business
   name. Admin-entered capability flags cannot substitute for this check.
9. Enable collection only after the test mapping and then the independent live
   mapping pass provider verification. Never copy test IDs into live records.

Razorpay documents the linked-account fetch as
`GET /v2/accounts/:account_id` and product readiness as
`GET /v2/accounts/:account_id/products/:product_id`. Composite onboarding is
`POST /v2/accounts`, but it must only be used when the authorized owner has
provided every required legal/settlement field and genuinely accepted the
provider terms. GETFIT4U currently uses the safer operator-linked workflow.

## Application APIs

- `POST /api/v1/checkout/platform/quotes`
- `POST /api/v1/checkout/quotes`
- `POST /api/v1/checkout/orders`
- `POST /api/v1/checkout/verify`
- `GET /api/v1/checkout/payments/:id`
- `POST /api/v1/webhooks/razorpay`
- `GET /api/v1/owner/payment-connection`
- `POST /api/v1/owner/payment-connection/onboarding`
- `GET /api/v1/owner/route-transfers`
- `POST /api/v1/owner/payments/:id/refunds`
- `GET /api/v1/admin/payment-connections`
- `PATCH /api/v1/admin/payment-connections/:id`
- `GET /api/v1/admin/route-transfers`
- `POST /api/v1/admin/route-transfers/:id/reconcile`
- `GET /api/v1/admin/refund-exceptions`
- `POST /api/v1/admin/refunds/:id/reconcile`

Reconciliation endpoints perform provider reads and local state reconciliation.
They never create a new charge, transfer, refund, bank change, or mandate.

## Status and accounting rules

Payment capture, purchase fulfillment, Route transfer, beneficiary bank
settlement, customer refund, and transfer reversal are separate status
dimensions. A captured payment is not settlement evidence. A submitted refund
is not a processed refund. A submitted partial transfer reversal remains
pending until Razorpay reports the updated transfer.

The owner Revenue screen excludes platform-plan collections from gym revenue
and shows that gym's transfer and settlement history. Admin finance shows all
beneficiary mappings plus transfer/settlement and refund/reversal exceptions.

Full original membership refunds may use Razorpay's combined `reverse_all`
flow. Partial refunds first submit the exact transfer reversal and then the
customer refund without `reverse_all`. Durable application reservations prevent
repeated submissions after an uncertain outcome. Matching uses the stored
provider payment plus the stable refund reference in Razorpay receipt/notes;
the integration does not invent an undocumented idempotency header.

## Migration and deployment

Run the migration as a dry run first:

```powershell
npm run db:migrate-razorpay-route
npm run db:migrate-razorpay-route -- --apply
```

The migration adds indexes and backfills fulfillment state only for captured
payments already linked to a subscription. It does not rewrite provider IDs,
create linked accounts, alter beneficiaries, revoke paid access, or delete
historical records.

Recommended rollout:

1. Deploy with `RAZORPAY_ROUTE_ENABLED=false`.
2. Run the migration dry run, review it, then apply it.
3. Verify ordinary platform checkout in Razorpay test mode.
4. Onboard two controlled test gyms and confirm Gym A and Gym B map to their
   own linked accounts.
5. Enable Route in test, run checkout/webhook/refund/reconciliation checks, and
   inspect settlement state separately.
6. Obtain written live Route approval and fee/funding agreement.
7. Create and verify live beneficiary records; then gradually enable live
   membership collection.

Rollback is fail-closed: set `RAZORPAY_ROUTE_ENABLED=false` to stop new online
gym membership orders while retaining platform checkout, paid access,
financial records, webhooks, reconciliation, and offline collection. Do not
delete transfer, refund, invoice, or provider event records.

## Certification boundary

Automated tests use mocked provider responses and do not charge a card, open a
UPI app, credit a beneficiary bank account, or prove live settlement. Controlled
live certification requires explicit operator authorization and must verify
the Razorpay Dashboard/API transfer, recipient settlement reference, bank
evidence, actual deductions, refund lifecycle, and two distinct gym
beneficiaries.

