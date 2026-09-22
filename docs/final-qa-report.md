# Database integration and QA report

Updated 2026-09-08. This report replaces earlier claims based on prototype fixtures.

The active React routes now load operational records through authenticated APIs. Public discovery reads eligible gyms from MongoDB. Empty databases show empty states; the application does not inject demonstration gyms, members, payments, charts, or notifications. Static marketing copy, labels and decorative artwork remain frontend content.

## Implemented flows

- Signup, password login, phone OTP, recovery, session restoration/revocation, and assigned role/gym switching.
- Public gym discovery with database search, geospatial filtering and pagination; database gym details, plans, classes, reviews and favorites.
- Member profile, memberships, freeze/cancel/renew checkout, attendance QR/history, class booking/cancellation, payments, invoices, workouts, progress, support and notifications.
- Owner onboarding, signed document uploads, review submission, platform-plan checkout, gym editing, member/trainer management, membership plans, class management, scanner attendance and in-app campaigns.
- Trainer assigned clients, workout plans and assignments, progress records and class schedules.
- Admin registrations/review transitions, platform plans, users/owners/gyms, moderation, audit records and configuration monitoring.
- Persistent conversations, scoped contact selection, message history pagination and polling.
- Shared API-backed tables with server pagination, search/status/date filters, error/retry states, validated editing and CSV export of the displayed page.

Tenant authorization is enforced by the API. Trainer membership responses omit plan/payment details. Payment capture creates subscriptions and immutable invoice snapshots in a MongoDB transaction. Repeated signed capture events are deduplicated. Payment metadata retains the quote snapshot after quote TTL expiry. Early renewal starts after the current paid membership ends.

## Verification

- Backend and frontend production builds passed. The workspace is loaded separately from the public application bundle.
- Backend unit suite: 16 tests passed.
- Frontend unit/component suite: 17 tests passed, covering authentication, nested form payloads, money conversion, pagination and visible errors.
- Isolated MongoDB integration suite: 81 checks passed, including cross-gym denial, class capacity/rebooking, scanner input, profile privilege protection, campaign deduplication, duplicate signed payment events and renewal continuity, trainer assignment/access, OTP replay rejection, notification pagination and related-record search.
- The integration runner disables external payment/SMS/storage calls and creates a uniquely named temporary database. Cleanup verifies that exact name before dropping it. Existing application records were not seeded, edited or deleted by tests.
- Required database indexes and the notification uniqueness migration were applied successfully, preserving existing records.
- Browser visual/E2E verification was attempted but no browser was connected. Camera behavior and responsive layout remain unverified in a real browser.

## Deployment and acceptance work still required

This work does not establish that the entire application is production-ready. The following boundaries are explicit:

- Razorpay live/test account checkout, actual webhook delivery, refunds and settlement reconciliation require provider acceptance testing. Automated checks simulate signed captures; they do not charge money.
- MSG91 OTP requires an approved template and credentials. Production does not expose OTP codes; development exposes codes only when SMS delivery is unconfigured. Actual provider delivery was not tested.
- Document uploads require an S3-compatible bucket, credentials and browser PUT CORS. Actual storage upload/download was not tested.
- In-app campaign delivery is implemented. WhatsApp/email/push campaign delivery, consent processing and provider callbacks remain incomplete; unsupported campaign sends return an explicit unavailable error.
- Offers, ads, referrals, refunds and settlements display stored records. Coupon redemption, ad serving/attribution, automated referral rewards and full refund/settlement operations are not completed by this integration.
- Workout plans and progress are stored; automated recommendations, exercise media libraries and detailed workout-session logging remain future work.
- Monitoring shows database/configuration information, not proof of third-party uptime. Multi-instance worker coordination, socket scaling, load testing, backup/restore drills and deployment hardening still need acceptance work.

## Repeatable commands

From `backend`: `npm run build`, `npm test`, `npm run test:integration`, `npm run db:inspect`.
From `frontend`: `npm run build`, `npm test`.

For a deployment upgrade, stop API instances and run `npm run db:migrate` from `backend` before restarting. It creates schema indexes and replaces the old sparse notification compound index with a partial unique index. It refuses duplicate nonempty dedupe keys. No notification data is deleted.

MongoDB must support transactions (Atlas or a replica set). The Compose file is a local-development stack with a single-node replica set, not a production database deployment. `npm run seed` is development-only and disabled in production; never seed an existing operational database.

## Gym registration follow-up

See [gym registration flow](gym-registration-flow.md) for the corrected draft/document/payment/review process and its 70-check isolated lifecycle suite. The current environment is missing `RAZORPAY_WEBHOOK_SECRET`, so live capture verification remains blocked until the matching provider secret is configured.
