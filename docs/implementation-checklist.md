# Coordinated enhancement checklist

The latest supplied requirements govern this implementation. Existing React/Vite, Express/Mongoose, role permissions, MongoDB transactions, media pipeline, payment snapshots, messaging and notification workers are retained. See [enhancement-release-report.md](enhancement-release-report.md) for final command outcomes and release limitations.

“Implemented / retained” describes repository behavior, not deployment or real-device acceptance.

| Requirement | Implementation and affected areas | Evidence / status |
| --- | --- | --- |
| 1 Inspection | Existing routes, models, roles, billing, media, workers, deployment and shared components inspected | Completed; existing architecture retained |
| 2 Latest precedence | Light/Dark, exact mobile tabs, Profile sections, separate Support, S3, owner QR/member scanner, promotion positions | Implemented; component and API regressions |
| 3 UI and logos | `GymIdentity`, existing compact styles, `enhancement-layout.css`, gym-specific sidebar/watermark, dashboard identity and invoice logo snapshot | Implemented; S3/PDF tests; live visual/device acceptance pending |
| 4 Themes/dialogs/back | Theme/init/migration; existing portal/focus Modal; scoped `WorkspaceBreadcrumbs` and member-list state | Implemented; theme/modal/direct-parent/list-restoration/dirty-form tests |
| 5 Platform/revenue | Side-by-side platform and capacity cards, real dates/limits/remaining usage/renewal; existing server revenue periods | Implemented / retained; platform/dashboard/revenue tests |
| 6 Members | Combined membership/access status, trainer, date-only fields, expiry warnings, View/Edit; new invitation status/list memory | Implemented / retained; filters/details/permissions tests; detail payments bounded to 50 recent records |
| 7 Lifecycle | Shared lifecycle service, valid actions, payment/refund/date guards, freeze audit and notification dedupe | Retained and integrated with invitation holds; lifecycle/isolated database coverage |
| 8 Onboarding | Atomic provision/link/payment; hashed 48-hour token; explicit activation or authenticated acceptance; resend and encrypted retry outbox | Implemented; actual account integration passed; real email blocked by provider setup |
| 9 Communication | Normalized Call, internal Message and distinct WhatsApp composer; pending/unrelated contact restrictions | Implemented / retained; phone/row-action/tenant/conversation tests |
| 10 Payments/invoices | Owner Reference column last; date-only Created; immutable paid invoice, SYSTEM receipt, notification/email queue; private download/resend/status | Implemented; PDF/authorization/idempotency and actual account integration; external provider acceptance separate |
| 11 Profile | Overview, Membership, Bookings, Payments, Attendance, Workouts, Favorites, Referrals, Social, Settings; existing privacy/posts/25-hour stories | Implemented / retained; Profile/navigation/social regressions |
| 12 Streaks | Unique-day calculation, timezone policy, calendar, current/longest streak and paginated history | Retained; timezone/duplicate/gap/correction coverage |
| 13 Attendance | Owner QR/camera retained; manual ignores GPS, records actor role/reason; admin action; no new backdating | Implemented; service/controller/component/isolated tests; physical camera testing pending |
| 14 Messaging/support | Permission-filtered contacts, archive/restore, deep links and separate tickets; read-only receipts | Retained / integrated; messaging/support/privacy/SYSTEM-write regressions |
| 15 Notifications | Durable notification/device/sound service; invoice/class events; configurable 0–7-day post-expiry follow-ups; stale push suppression | Implemented / retained; reminder/device tests and simulated-provider integration; actual push pending |
| 16 Classes/bookings | Validated forms, S3 class media, binding/cleanup guards, atomic capacity, exact booking link, reminders/trainer-change events | Implemented; unit/component and isolated concurrency/IDOR/cleanup coverage |
| 17 Offers/ads | Authoritative pricing/redemption; plans beside offers; ads directly above classes; manual carousel; no empty ads block | Implemented / retained; layout/carousel/pricing/eligibility tests |
| 18 PWA | Manifest/icons, install settings, exact tabs, keyboard/safe areas, private-cache-safe offline fallback and controlled worker updates | Implemented; worker/install-intent tests and production build; actual install/HTTPS/device acceptance pending |
| 19 Storage/email | S3 validation/thumbnails/authorized access; new leased encrypted email retries | Real S3 round-trip verified; email transport mocked until configured |
| 20 Gym/admin config | Typed audited class/membership reminders; existing terms/admin safeguards/broadcasts; admin manual check-in | Implemented / retained; validation and permission regressions |
| 21 Security/performance | Redacted structured logs, auth/tenant guards, bounded queries/indexes, pending-link privacy and private media/invoices | Implemented / retained; authorization/audit and limited credential scan in report |
| 22–23 Acceptance/delivery | `verify.cmd`, guarded DB/S3 suite, simulated Firebase, audits, credential scan and migration/API/env notes | Local outcomes and external acceptance separately recorded in report |

## Assumptions

- Manual attendance records the present time. `occurredAt` and `createdAt` remain separate; arbitrary historical backdating is not introduced.
- Account acceptance removes only the invitation hold. Ineligible/suspended/future/expired/refunded memberships do not gain access; normal lifecycle/renewal actions remain required where applicable.
- Promotion carousels have no automatic advancement.
- Unreferenced new class images receive at least 24 hours of retention before bounded retryable cleanup. Historical class and invoice-logo references remain protected.
- Verification does not reset, seed or migrate production databases. Cleanup requires unique temporary database names and ownership markers.
- Missing email credentials and actual browser/device acceptance are external release gates.
