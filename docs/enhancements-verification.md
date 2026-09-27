# GETFIT4U enhancement handoff

## Repository and preserved architecture

Implementation targets the existing `Desktop/App/GitFit4U` checkout, not the older JavaScript `gym`/`gym-dashboard` workspace. The inspected application uses React 19, TypeScript, Vite 8, TanStack Query, Express 5, Mongoose 9, MongoDB, Socket.IO, Razorpay, existing Firebase push delivery and database-leased background workers. Tenant authority comes from the authenticated session and active RoleAssignment, never a browser-supplied owner ID.

Existing routes, account identities, support tickets, media attachments, financial records and attendance history are retained. Existing environment files were not overwritten. Money remains integer INR minor units. Gym member contact changes remain tenant-specific rather than changing a member's platform sign-in identity.

## Implemented requirements

| Requested area                                     | Implementation                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headings, plan cards, map/filter/download controls | Responsive shared typography and toolbars; content-driven plan cards; existing backend-supported filters                                                                                                                                                 |
| Gym identity, logo settings, watermark             | Tenant-owned validated attachment ID; upload, preview, replace, remove; fresh media URLs; logo/name fallbacks; owner identity and low-opacity noninteractive watermark                                                                                   |
| Themes                                             | System default; persistent light/dark/system selection; initial theme script; OS-change listener only in system mode                                                                                                                                     |
| Membership lifecycle                               | Shared transactional transition service; freeze allowance and dates, early return adjustment, invalid-transition rejection, history and notifications                                                                                                    |
| Owner members                                      | Scoped list/detail/edit; visible actions and desktop double-click; original membership/payment/attendance columns; deactivation retains history                                                                                                          |
| Manual membership creation                         | Actual active gym plan; server-priced amount and computed end date; atomic member/subscription/OFFLINE payment; collection method/reference/actor                                                                                                        |
| Trainers                                           | Contact validation, profile, experience, qualifications, specializations, per-day availability and status; synchronized role access                                                                                                                      |
| No-plan joining                                    | JOIN_REQUESTED member relationship and explicit approval; no synthetic plan or payment; approved direct access eligibility                                                                                                                               |
| New attendance direction                           | Owner displays one persistent signed gym QR identity; member uses real camera; auth-derived member, gym/membership/date/timezone checks, revocation, unique daily check-in and optional location requirement                                             |
| Admin management                                   | Account editing/status, tenant role assignment, gym configuration/status/archive, trainers, members and join decisions, plans, membership transitions, review moderation, notification archival, public support settings and audited financial reversals |
| Admin announcements                                | Audience roles, compose/history, server idempotency, bounded leased worker and unique per-recipient delivery                                                                                                                                             |
| Support and messaging                              | Additive historical ticket bridge; shared conversation UI; authenticated bubble direction; bounded chat viewport; read state; attachment permissions; own-message deletion and per-user conversation archive                                             |
| Notifications                                      | Central typed event copy and stable dedupe; membership/payment/account/trainer/attendance/review/support/message/gym events; preference-aware delivery; generic announcement push copy                                                                   |
| Revenue                                            | Membership income only, excludes platform fees; captured cohort less processed refunds, including fully refunded receipts; date filters, compact KPIs and daily series                                                                                   |
| Cloudinary                                         | Signed server-side provider alongside S3; actual-byte MIME/size validation, provider identifiers and metadata, protected private attachments, meaningful sanitized errors                                                                                |
| Reviews                                            | Eligibility, one review per member/gym index, own-review read/edit, public pagination and rating distribution, moderation preserved                                                                                                                      |

Admin gym creation continues through the existing registration and verified-payment activation lifecycle. Neither admins nor owners can bypass paid platform activation with arbitrary CRUD. No financial, audit or attendance hard-delete operation was added. Real-time voice/video calling is not fabricated; an external phone action is shown only for a real authorized contact.

## Business rules

- Frozen memberships already include their planned extension. Early reactivation returns unused whole freeze days; elapsed partial days count as used. Expired/cancelled memberships require renewal rather than an arbitrary ACTIVE flag.
- Cancelling/deactivating access is separate from refunding money. Offline refunds record a confirmed external repayment; they do not transfer funds.
- Revenue filters select capture dates in UTC; daily chart grouping uses the gym timezone. Processed refunds are deducted from the same receipt cohort, even if the refund occurred later. Pending payment attempts are shown separately, not counted as income.
- Attendance is one check-in per member/gym/local date. The QR is a revocable locator, not standalone access authorization. A photographed persistent QR cannot prove physical presence; gyms can require fresh, sufficiently accurate location evidence. Browser-reported location is not a tamper-proof anti-fraud signal.
- A new manually created account needs a phone for the existing OTP activation path. No password is distributed or inferred.

## Verification commands

Final verification on 2026-09-27:

- Backend: 30 test files, 187 tests passed; TypeScript production build passed.
- Frontend: 25 test files, 166 tests passed; TypeScript/Vite production build passed without bundle-size warnings.
- Both `npm audit --json` reports: zero vulnerabilities at every severity. Dependency manifests and lockfiles were unchanged.
- All changed source files passed Prettier checks. Implemented-source whitespace checks passed; the user's pre-existing `.env.example` changes were excluded and preserved.
- The configured MongoDB replica set resolved and connected successfully. The application's existing database was not used for write tests.

Additional security regression coverage includes live tenant suspension enforcement, single-use transactional password recovery, revocation of old recovery grants after administrative account changes, and serialized cross-gym trainer access changes.

From `backend`: `npm run build`, `npm test`, `npm audit`, `node src/scripts/diagnose-database.mjs`, and `node node_modules/tsx/dist/cli.mjs src/scripts/check-media-configuration.ts`.

From `frontend`: `npm run build`, `npm test`, and `npm audit`.

Database-backed verification: from `backend`, run `node node_modules/tsx/dist/cli.mjs src/scripts/verify-isolated-membership.ts --run-isolated`. It overrides only the database name with a fresh random `gfv_` name, requires an empty database and ownership marker, and deletes only that exact test database. It does not invoke payment, OTP or push providers.

Add `--verify-media` to explicitly exercise the configured real media provider. This uploads two tiny generated PNGs, validates returned owner/public image URLs, replacement, cross-tenant rejection and removal, then deletes only its recorded test object keys before dropping the test database. The configured S3 provider passed these checks. Cloudinary integration has automated provider tests but was not exercised against a live Cloudinary account.

The isolated verification passed 15 workflow groups including media, transactional offline membership creation/rollback, tenant authorization, lifecycle dates, concurrent QR check-ins and revocation, direct joining, revenue/refunds, review ownership, support-history preservation, broadcast deduplication, concurrent offline refunds, safe member archival, concurrent multi-gym trainer deactivation and suspension enforcement against existing/new sessions. The two test media objects and the run-owned temporary database were removed. No real payment transfer, OTP or push delivery was triggered. Existing Mongoose `new` option deprecation warnings do not fail these checks; they remain an upstream-compatibility cleanup item.

## Deployment requirements

1. Back up the application database and deploy during a maintenance window.
2. Run the existing `npm run db:migrate` before admitting traffic. New uniqueness indexes protect daily attendance, gym QR identity, conversations, announcements and refund idempotency. The migration preserves records and refuses unresolved duplicate notification keys; it is not an automatic duplicate-data deletion tool.
3. Optionally run `node node_modules/tsx/dist/cli.mjs src/scripts/migrate-support-conversations.ts` for the additive support-history migration. Normal conversation reads also bridge old tickets safely.
4. Configure the selected media provider as described in `media-storage.md`; secrets remain backend-only. Existing S3 attachments retain their provider and continue resolving through S3 after selecting Cloudinary for new uploads.
5. Use HTTPS for real-device camera access, secure cookies and push. Verify camera permission granted/denied/no camera, mobile rear camera, route-exit cleanup and duplicate feedback on physical devices.
6. Verify provider credentials/webhooks and legal/privacy content for your deployment. Dependency audits are not a guarantee of zero application vulnerabilities. The existing legal page requires business-approved production wording.

## MongoDB DNS diagnostic

The reported `querySrv ECONNREFUSED` occurs during SRV DNS resolution, before database authentication. The active GETFIT4U checkout was read-only tested successfully against its configured replica-set cluster; it is not the hostname from the earlier error. Do not replace the current connection with an invented URI or disable TLS. If the old cluster is still needed, check its availability and DNS, or copy its Atlas-provided standard connection string. See [MongoDB Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

## Acceptance boundaries

Automated unit/UI tests and isolated live-database checks do not replace physical-device camera acceptance or live payment/push acceptance. The Browser skill's required browser-control tool is unavailable in this session; no live browser visual acceptance is claimed. The repository has no dedicated ESLint/lint script; TypeScript production builds, unit/UI tests, changed-source formatting and whitespace checks are the available automated gates, not a substitute claim of an ESLint pass. Production data/index migrations have not been executed against the application's real database. Point 27 in the supplied requirements was empty.
