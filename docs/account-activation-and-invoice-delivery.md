# Account activation and invoice delivery

## Implemented behavior

Owner-created member records, membership, recorded offline payment, invoice, activation/invitation grant and email outbox entry commit in one MongoDB transaction. The active gym plan determines the total and dates. No default password is created. Newly provisioned accounts retain the existing `PENDING_VERIFICATION` account status until password activation; their new gym relationship is held inactive pending acceptance.

New accounts receive a 48-hour invitation with a cryptographically random single-use token. Only its SHA-256 digest is stored in the invitation collection. The outbound email envelope is AES-256-GCM encrypted. A GET never activates an account. Password activation requires an explicit POST and validated password; changed, expired and consumed tokens cannot be reused.

Established accounts must sign in to the exact invited account before accepting the gym relationship. Their global name, email, phone, password and existing roles are preserved. Explicit acceptance adds the USER role where necessary. Before acceptance, gym management sees only its own entered contact details, including on invoices; contact search excludes the pending relationship. A paid membership does not bypass a pending invitation, account suspension, gym suspension, membership freeze/cancellation, future start, expiry or refund checks.

Owner member lists/details expose invitation status and a Resend Invitation action. Resend creates a new token revision, invalidates the previous token and cancels queued earlier email revisions. It does not recreate the member, subscription or payment. Resend has per-owner/IP limits and a one-minute per-invitation cooldown.

Authoritative existing payment capture paths generate/reuse invoices. Each invoice has one transaction snapshot, one persistent read-only SYSTEM message in the existing messaging system, one centralized in-app invoice notification, and one original email outbox event. Invoice numbers, amounts, supplier/customer details, plan dates and offer/tax snapshots are reused on retries. Pending or failed payments cannot obtain paid invoices. Gym membership and platform payment purposes are stored separately. New immutable invoice references retain their historical gym logo attachment; PDFs use the complete image with contain sizing.

The invoice email provides an authenticated account link to Profile → Payments or owner platform payments. PDFs use the existing authorized private download endpoint with `private, no-store`; no public invoice object or bearer download URL is created. The system receipt thread rejects user replies/deletions; its invoice action opens the corresponding payments screen.

## Delivery and configuration

Repository inspection found no existing transactional-email provider or credentials. The optional server-side adapter uses Resend, without adding a dependency. Configuration variable names (examples are blank):

- `RESEND_API_KEY`: provider credential, never a frontend variable.
- `EMAIL_FROM`: verified sender identity.
- `EMAIL_ENCRYPTION_KEY`: stable secret of at least 32 characters. If omitted, a domain-separated key is derived from the existing server refresh-token secret. Rotate only after draining/reissuing encrypted pending emails, or provide a migration that decrypts with the old key.
- `CLIENT_ORIGIN`: existing setting supplies the trusted application origin. Production email links require HTTPS.

Delivery runs from existing maintenance after transaction commit. Missing credentials leave durable messages queued, preserving the successful payment/member. Worker leases prevent competing workers from claiming the same message. Retries use a stable provider idempotency key, bounded attempts and backoff. Ambiguous sends older than 23 hours stop as `EMAIL_RECONCILIATION_REQUIRED`, because the provider retains idempotency keys for 24 hours. Operators must reconcile provider records before any manual requeue beyond that horizon.

`QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED` and `BOUNCED` are distinct persisted email statuses. Provider acceptance records `SENT`, never `DELIVERED`. A subsequent authenticated provider status lookup records confirmed delivery. No delivery has been claimed or tested against a live email account in this change.

Provider contract references: [send email](https://resend.com/docs/api-reference/emails/send-email), [idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys), [retrieve sent email and last_event](https://resend.com/docs/api-reference/emails/retrieve-email).

## APIs and compatibility

- `POST /api/v1/auth/activate-account`: token + password, rate-limited, CSRF-protected; does not create a login session automatically.
- `POST /api/v1/auth/accept-invitation`: token + authenticated intended account, rate-limited, CSRF-protected.
- `POST /api/v1/owner/members/:id/invitation/resend`: owner gym context and member-write permission required.
- `GET /api/v1/workspace/payments/:id/invoice/email`: same authorization as private invoice download; returns generation, queue, provider-accepted and confirmed-delivery status/timestamps without exposing the recipient address or email envelope.
- `POST /api/v1/workspace/payments/:id/invoice/email`: explicitly request an invoice copy using `Idempotency-Key`. Reuses the immutable invoice and existing system message, replaces unsent queued copies, retains sent/failed history, enforces per-user rate limits and a one-minute shared invoice cooldown, and returns the existing result for a replay. The shared invoice actions expose Email invoice and Email status. Missing delivery configuration is shown as queued/temporarily unavailable, never sent.
- `/activate-account`: public page, activation bearer token carried in the initial URL fragment and kept only in tab session storage through login. Known safe login return routes now include this page.

Additive schema changes introduce `AccountInvitation`, `TransactionalEmail`, `MemberProfile.invitation`, invoice payment purpose, SYSTEM conversations and optional system-message invoice/action fields. Existing members without invitation fields remain established relationships. Existing account status values are preserved. No production records were modified or deleted.

Run the existing `npm run db:migrate` only during deployment review/maintenance to create new indexes (invitation member uniqueness, email event-key uniqueness/worker indexes, invoice logo-reference index). It is not executed against production as part of the automated checks. New account and financial transactions continue to require a MongoDB replica set, as existing payment flows already do.

## Verification coverage

Focused unit tests cover encrypted envelope tampering, single-use/expiry claim predicates, wrong-account refusal, no password overwrite, existing-profile privacy, eligibility/date bounds, missing provider configuration, provider retry behavior, provider idempotency horizon, invoice event reuse, snapshot privacy and private PDF generation. Frontend tests cover scanner-safe opening, explicit activation/acceptance, matching passwords and secret-free login return URLs.

The guarded isolated MongoDB runner includes actual activation/login, consumed/expired/replaced-token rejection, resend without duplicate financial records, matching-account acceptance, pending account privacy across owner and workspace listings, invoice/message/notification/outbox idempotency, historical snapshot preservation, SYSTEM thread write rejection and authorized private PDF retrieval. It queues email only; it never invokes a delivery provider. Live provider receipt/delivery confirmation needs configured verified sender credentials and a separately authorized smoke test.

The targeted real-database command `npm.cmd run test:enhancements -- --section account` passed on 2026-09-27 with all five account/invoice groups successful and its temporary database cleanup confirmed. The account selector retains the full runner's random `gfv_` database, empty-database check, ownership marker, migration/index setup and guarded cleanup; it does not run S3 verification and rejects combining the selector with `--verify-media`. The initial scanner assertion was corrected to check the actual persisted unused-token sentinel (`consumedAt: null`) instead of an absent field. No production business rule was weakened.
