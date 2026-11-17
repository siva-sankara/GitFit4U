# Manual members, secure welcome and WhatsApp invitations

Implemented in the existing application on 14 November 2026. This report supersedes the offline-payment eligibility limitation in `WHATSAPP_MEMBERSHIP_INVITATIONS.md`.

## Confirmed causes

- Manual creation previously set new users to `PENDING_VERIFICATION` and member profiles to `INACTIVE` whenever an invitation was needed, even after recording the full cash payment. Attendance and class checks also treated the pending invitation as an access hold. Email/setup, account enablement and paid membership were coupled. The post-save screen exposed this invitation state instead of a clear financial/account result.
- The older `manualWhatsAppService.whatsappGroupInput` rejected every query string, required an undocumented 10–128-character token, and rejected a trailing slash. Duplicate invitation controls could write different configuration fields. Normal share links could therefore fail despite having an official host and valid invitation path. The new shared parser handles the URL parts independently, and the profile has one invitation editor.
- The profile invitation notice was inline without a wrapping action/status layout. Its status, button and delivery message now use separate wrapping elements.

## Resulting states and account behavior

| Concern | New manually paid member | Existing account |
| --- | --- | --- |
| Account | `ACTIVE`, `firstAccessPending: true` | Credentials, roles and global contacts preserved |
| Contact verification | Neither contact marked verified by owner entry | Existing verification preserved |
| Membership | Fully paid; dates control access | Same paid membership rules |
| Future start | API/modal shows `SCHEDULED`; attendance rejects early access | Same |
| Offline receipt | Real `OFFLINE`, `CAPTURED`, fulfillment `APPLIED`; collector, collection date, method, amount and notes retained | Same |
| Temporary credential | Unique random 192-bit value, bcrypt verifier, default 24-hour expiry | Never generated/revealed |
| First login | Temporary password grants setup only; verify contact and choose a password | Existing login, with existing authenticated gym-link acceptance where needed |
| Welcome | Explicit queued action after financial commit | Login/link guidance; no password reset |

The existing database subscription status remains `ACTIVE` with authoritative `startsAt`/`endsAt`. `SCHEDULED` is its presentation before the start date, not a new database enum or early attendance permission. `offlineAccessGranted` removes the legacy invitation hold only for the recorded paid relationship; validity, account restrictions, frozen/cancelled access and gym checks remain in effect. Global profile privacy still applies to unaccepted relationships.

Creation validates the managed gym, current plan price/discount/tax/duration, exact full payment and permissible dates. Conflicting email/phone identities, blocked accounts and existing unverified registrations are rejected safely before collection is recorded. An existing unfinished registration must complete verification; it is not silently reset or merged by the owner.

The database transaction creates/links the member, subscription, receipt, invoice and audit/domain records. A stable idempotency key binds the request body to the saved result, including concurrent submissions. Its replay omits the temporary password. The frontend invalidates member/count/revenue queries and opens the success modal instead of navigating immediately to a misleading pending-activation detail screen.

## First-access credentials

`MemberBootstrap` stores only a bcrypt verifier, expiration and hashed, ten-minute setup grant. The password is returned once in a private/no-store creation response; the modal masks it and offers reveal/copy. It is held in component memory, not browser storage, message payloads, logs or the idempotency archive. Closing the modal or changing account/gym clears that UI result. Losing the response is handled by welcome/setup email or verified recovery, not password recovery from storage.

Temporary login works with normalized email or phone and issues no normal JWT/session. The existing OTP/recovery/password routes complete possession checks and password selection. Normal API authentication and refresh reject first-access-pending accounts. Email setup uses a high-entropy, hashed, 48-hour single-use invitation from configured `CLIENT_ORIGIN`; opening the page does not consume it. Explicit password submission claims it. Successful setup removes the bootstrap verifier and consumes outstanding activation invitations.

## Welcome delivery

- `GET /api/v1/owner/members/:id/welcome` returns only the authorized gym's committed recipient, plan, dates, receipt, optional invitation, safe composer preview and delivery status.
- `POST` to that path requires the confirmed recorded email and an idempotency key. The recipient cannot be replaced with an arbitrary address. A one-minute cooldown and audit trail apply to resends.
- The existing encrypted transactional outbox now supports `GRAPH` for welcome/setup mail, reusing the Microsoft 365 Graph sender. Both mailbox and From must be `support@getfit4u.in`. Existing invoice delivery remains on its existing transport.
- Provider acceptance is `SENT`, displayed as accepted with inbox delivery unconfirmed. Only supported provider evidence can report `DELIVERED`. Queued, submitting, failed and replaced/expired states are distinct.
- Missing configuration retains queued work. Known failures retry. Ambiguous Graph submission, a recovered in-flight send, or failure to persist a provider acceptance requires review instead of automatic duplicate submission. Encrypted setup payloads are removed on successful send and purged when cancelled or older than 48 hours.
- Welcome failure cannot undo membership/payment creation. Automatic invoice delivery remains separate. Offline creation suppresses the duplicate Meta membership welcome; existing API OTP, other transactional messages and payment notifications continue through their established paths.
- WhatsApp uses the normalized gym-record phone and an explicit preview followed by `wa.me`. The owner presses Send in WhatsApp. No password, OTP, setup bearer or session token is included. The legacy activation-reminder composer was also changed to ordinary login guidance, with secure setup delivered in email. Opening the composer is never reported as sending or delivery.

For existing active accounts, a pending gym-link invitation uses the established authenticated acceptance route with **Login to GETFIT4U** wording. It cannot change their password. Already accepted relationships use the normal login URL.

## Separate member and owners invitations

| Scope | Configuration/API | Eligibility and placement |
| --- | --- | --- |
| Gym members | Gym Profile → WhatsApp Group / Channel; owner `GET/PATCH /api/v1/owner/communication/whatsapp-updates` | Own gym membership, active member/gym, unexpired ACTIVE/FROZEN subscription and bound captured/applied payment. Razorpay or properly recorded offline collection qualifies. Shown after payment, in the creation modal and under member Membership. |
| Platform owners | Admin Settings → GETFIT4U Gym Owners invitation; admin `GET/PATCH /api/v1/admin/settings/owners-whatsapp` | Active owned gym and unexpired ACTIVE platform subscription with a bound captured/applied platform payment. Shown after platform payment and on Owner Dashboard/Platform Subscription. |

Member invitations use `Gym.whatsappUpdates` (private projection). Owners invitations use the separate `PlatformSettings` key `private.whatsapp.platform-owners`. Owners cannot edit that platform configuration. Member purchase responses do not reveal it. Merely approving a gym without a captured platform payment does not establish invitation eligibility. Refund requests, processing and completed refunds exclude an invitation. Paid future-start/frozen members may receive announcements; that does not grant attendance access.

Relevant read APIs are `GET /api/v1/users/me/subscriptions/:id/whatsapp-updates` and `GET /api/v1/owner/platform/whatsapp-invitation`. Payment return uses the backend's existing captured/fulfilled payment relationship, never a client success flag. Missing invitations do not block normal payment completion or dashboard access.

## Link validation and QR storage

The frontend and backend parser sources are kept identical by a regression test. HTTPS official group and channel hosts, case-sensitive tokens, recognized wrappers, trailing slashes and supported share parameters are canonicalized. Share text requires explicit choice of its detected link; multiple candidates are never selected silently. Credentials, ports, unsafe schemes/hosts, path traversal, encoded token mutation, shorteners and unsupported redirect parameters are rejected. No private invitation is fetched or sent to an external validation service. **Open link to test** performs the owner's manual check; format validation cannot prove validity, capacity or ownership.

Both settings scopes provide `POST <settings-path>/qr` multipart uploads. The field is `qr`; authentication, scope, permissions and rate limits precede decoding. PNG/JPEG/WebP are limited to 5 MB, 16 megapixels and 6,000 pixels per side, with content validation and still-image enforcement. Sharp strips metadata without cropping/resizing the code; `zxing-wasm` decodes locally using the installed WASM file, with no CDN/private-link request. Exactly one valid invitation QR is required.

A nonempty saved URL must match the canonical decoded invitation. An empty URL permits explicit confirmation of the detected destination before publication. Uploaded metadata binds the asset to its gym/owner or platform-admin scope; settings cannot reference another tenant's asset. Changing the URL invalidates the old QR. Configuration versions increment atomically.

The existing S3 service stores images beneath `private/whatsapp-invitations/`, with opaque server-generated keys and 120-second signed reads. No object key is returned to the browser. Removing/replacing a QR unpublishes its association; a previously issued signed URL expires naturally. Private, unreferenced uploaded objects are retained rather than deleted during a settings update; storage lifecycle/cleanup remains an operational concern.

Eligible invitation cards include direct Join/Follow, copy, QR preview and an enlarged QR. A locally generated high-contrast QR is the fallback when no uploaded image is configured. No attendance token/field/scanner route is repurposed. Group membership is optional; opening/scanning is not proof of joining. Previously copied links/screenshots cannot be revoked by changing GETFIT4U settings; reset them in WhatsApp. Group members may see each other's phone numbers.

## Main code and additive model changes

- Creation/authentication: `backend/src/controllers/{memberManagementController,authController,accountInvitationController}.ts`, `services/{memberBootstrapService,accountInvitationService,tokenService}.ts`, `middleware/auth.ts`, `models/{User,Member}.ts`, auth/owner routes.
- Delivery: `controllers/memberWelcomeController.ts`, `models/Delivery.ts`, `services/{transactionalEmailService,memberReminderService}.ts`, `integrations/notifications/microsoftGraphOtpProvider.ts`, logger redaction.
- Access/eligibility: attendance, member-class-access, membership-lifecycle and WhatsApp-updates services; owner summary and checkout controllers.
- Invitation/QR: `models/Gym.ts`, `services/{whatsappUpdatesService,invitationQrService,manualWhatsAppService}.ts`, `controllers/whatsappUpdatesController.ts`, `routes/invitationQrUpload.ts`, owner/admin/user routes and `utils/whatsappInvite.ts`.
- UI: `MemberCreationSuccess`, `MemberInvitationStatus`, `WhatsAppUpdatesSettings`, `MembershipWhatsAppUpdates`, `OwnerMembersPage`, account activation/login, gym profile, owner dashboard/subscription, admin settings, registration/payment return and `styles/whatsapp-updates.css`.
- New collections: `MemberBootstrap` (unique user and expiry TTL indexes), `InvitationQr` (unique public ID). Existing receipt, subscription, invitation, encrypted outbox and idempotency collections are reused.
- Dependencies: pinned `zxing-wasm@3.1.6`; compatible audit fixes in both lockfiles, without forced major upgrades. Decoder configuration was checked against its [official documentation](https://github.com/Sec-ant/zxing-wasm).

## Deployment and existing records

1. Install from each lockfile with `npm ci`, build and deploy frontend/backend. Backend installation must retain the installed `zxing-wasm/reader/zxing_reader.wasm` asset. Restart the always-on backend and its existing maintenance scheduler; welcome delivery is not driven by an open browser.
2. Run the repository's existing index migration (`npm run db:migrate`) through the normal deployment procedure so the new unique/TTL indexes exist. This migration also performs its pre-existing notification/OTP retention-index maintenance. No live index migration was executed in this task.
3. Configure the existing `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, sender mailbox/From `support@getfit4u.in`, reply-to, trusted HTTPS `CLIENT_ORIGIN`, stable email-encryption key and existing private AWS S3 credentials/bucket. Welcome Graph sending uses its own credential readiness check; it does not require enabling the dual OTP email feature. No secrets were added to source or printed.
4. `MEMBER_TEMP_PASSWORD_HOURS=24` is the default; supported range is 1–72 hours. It is documented in `backend/.env.example`.
5. For previously saved cash members still held by an invitation, run `npm run db:migrate-manual-member-access` for a **dry-run count**. After reviewing the candidates, `npm run db:migrate-manual-member-access -- --apply` updates only eligible bound, fully paid, unrefunded offline memberships. It preserves global restrictions/contact verification, creates no receipts/passwords and records an audit. **This live-data migration was not run.** Existing screenshot records therefore need that reviewed repair after deployment.
6. Configure the gym member invitation and, independently, the Admin owners invitation. Legacy group values can prefill the new owner editor but stay disabled until deliberately saved/enabled.

## Verification

Final command results are recorded below. Live Graph delivery, real S3 object access and physical phone/PWA rendering are not inferred from mocked transport tests.

- Backend full regression: `npm test -- --maxWorkers=4` — **111 files, 897 tests passed**.
- Database-backed API workflow: `npm run test:member-welcome` — **passed all six scenario groups**, including simultaneous submissions, safe replay, expired/replaced bootstrap, email/phone temporary login, setup single use, preservation of existing credentials, future attendance denial and separation of invitation scopes. Used a fresh temporary database, asserted its identity before removal and deleted it afterward. Email, WhatsApp, Firebase and S3 transports were disabled.
- Frontend full run: **664/666 passed**. One existing Messages back-link assertion fails because its button is already commented out in HEAD; that unrelated UI choice was preserved. One promotion test hit the five-second timeout under parallel load. Rechecking promotions and the final welcome-modal assertions with `--maxWorkers=1` passed **2 files / 6 tests**. The earlier targeted member-editor, registration, authentication, activation, success-modal and settings run passed **6 files / 68 tests**.
- Backend and frontend production builds (including TypeScript) and both ESLint checks passed. After the final invitation-preview polish, frontend `npm run build`, `npm run lint` and the nine-file affected UI suite passed again: **97 tests** across creation, settings/QR, member invitations, payment return, registration, login/setup and member subscriptions. No failing test remains in the required affected suites.
- Dependency audit after compatible fixes: frontend **0 findings**; backend **6 Moderate, 0 High/Critical** (transitive Google/Firestore `glob`/`minimatch`/`rimraf` dependency chain). No forced breaking upgrade applied. These counts are limited to npm's reported advisories at audit time.
- Targeted secret-pattern scan: **91 changed/new source/config-example/documentation files, no matches** for private-key, AWS, GitHub, Slack and JWT patterns. A dedicated secret scanner was unavailable; this is not a guarantee that every possible secret format was detected. `git diff --check` passed.

The tests include real local QR decoding and negative cases, cross-scope rejection, canonical parser equivalence, Graph ambiguity handling, attendance/class access and the existing backend authentication/payment/invoice suites. External WhatsApp joining, configured mailbox permissions/inbox delivery, private bucket policy and device rendering still require environment/device verification.

## Follow-up: active members still displayed as pending

A remaining directory condition replaced the member's saved status with `PENDING_ACTIVATION` whenever `invitation.status` was `PENDING`, including paid members with `offlineAccessGranted: true`. The profile setup notice, client WhatsApp reminder selection and owner-created chat also still used activation wording for that state.

The member row now preserves the actual paid access status. Login/setup mail is labelled separately, the client reminder agrees with the backend's general-follow-up selection, and opening a chat for an enabled offline member does not create an activation notice. Future start dates display Scheduled; suspension/cancellation still takes precedence. Contact-possession checks and unaccepted-relationship privacy remain intact.

Regression verification: **7 frontend files / 30 tests** and **5 backend files / 26 tests** passed. The isolated database workflow now passes **seven scenario groups**, including an assertion that a newly paid member is listed as Active, counted outside Pending Activation, can check in, and opens a normal chat **before any welcome email or login/password setup**. Its temporary database was removed; no production member records were changed.
