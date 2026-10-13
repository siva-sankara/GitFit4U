# Razorpay Route implementation report

## Implementation status

The new-payment path is Razorpay-only. Platform subscriptions use ordinary
Razorpay Orders with no gym transfer. Paid gym memberships resolve an approved
beneficiary from the selected gym and attach one full-amount INR Route transfer
to the Order. GETFIT4U membership commission is fixed at zero in the immutable
financial snapshot.

Implemented application controls include:

- explicit purchase purposes, server quotes, paise-only arithmetic, offer and
  tax snapshots, payer/gym/plan eligibility, and a free-flow guard;
- provider/environment validation and fail-closed Route readiness;
- owner consent capture and admin review with live Razorpay account/product
  reads instead of manually asserted capability flags;
- per-gym versioned linked-account mapping and immutable order beneficiary
  snapshots;
- Razorpay Standard Checkout using only the public Key ID returned by the
  backend;
- stored-order signature verification, API capture verification, idempotent
  fulfillment, raw-body webhook HMAC, durable event receipts, and event-ID
  deduplication;
- separate payment, fulfillment, transfer, settlement, refund, and reversal
  records/statuses;
- full refund plus `reverse_all`, partial transfer reversal plus refund, and
  exception reconciliation without duplicate submissions;
- tenant-scoped owner transfer/settlement views and platform-wide admin
  readiness/exception monitoring;
- offline collection and payment-pending activation retained without creating
  fake Razorpay receipts;
- existing invoices, domain notifications, email queueing, and paid validity
  preserved through the shared fulfillment service;
- additive migration with dry-run default and no historical provider rewrite.

Incomplete PhonePe runtime/provider scripts and documentation were removed.
PhonePe remains only in historical model enums so old financial records are not
erased or misrepresented.

## External prerequisites and blockers

Code and a feature flag cannot prove Route eligibility. Before live member
collection can be enabled, GETFIT4U still requires:

1. activated live Razorpay merchant credentials and a distinct live webhook
   secret;
2. explicit Razorpay Route enablement for the actual marketplace/service model;
3. any required compliance, turnover/assessment, and payer-payee declarations;
4. an approved fee-bearer/pricing agreement and adequate platform funding when
   the full gross membership amount is transferred;
5. an activated Route linked account and product configuration for every gym,
   with provider-verified settlement destination;
6. controlled live platform, Gym A, and Gym B payments plus independent bank
   settlement evidence.

Until those conditions are met, leave `RAZORPAY_ROUTE_ENABLED=false`. Platform
checkout remains independently available when its ordinary Razorpay credentials
and webhook are configured. Gym online membership collection fails closed and
does not route funds to GETFIT4U as a substitute.

## Verification evidence

TypeScript no-emit checks and production builds pass for backend and frontend.
Both zero-warning ESLint gates pass. The full backend suite passes 777 tests in
103 files; the full frontend suite passes 596 tests in 91 files. The latest
focused Route/payment-connection/refund run passes 19 backend tests, and the
frontend checkout/PWA-return run passes 13 tests.
Production dependency audits reported zero known vulnerabilities for both
packages. A tracked-file credential-pattern scan found only the documented
Firebase placeholder and no committed private credential. Focused tests cover
standard platform orders without transfers, one server-selected
gym transfer, explicit Gym A/Gym B routing isolation, rejection of multiple beneficiaries, stored-order signature
verification, linked-account/product API reads, full-versus-partial refund
payloads, readiness blockers, refund reservation/replay protection, webhook
refund reconciliation, application startup, and Vercel typing.

The isolated MongoDB integration flow passes 118 checks, including rejection
of client-supplied beneficiary, transfer-amount, and commission fields, and removes its
temporary database after completion. The isolated registration/platform-payment
flow passes 126 checks, creates two simulated gateway orders, performs no real
charge, and also removes its temporary database.

These are automated/mock results only. No real card/UPI payment, refund,
Razorpay account mutation, real webhook delivery, or bank settlement was
performed by this implementation session.

See [Razorpay and Razorpay Route payments](RAZORPAY_ROUTE_PAYMENTS.md) for setup,
API inventory, migration, rollout, rollback, and live certification steps.
