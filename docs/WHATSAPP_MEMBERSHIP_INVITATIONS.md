# Membership invitations and notification routing

> This report describes the 13 November implementation. The coordinated 14 November enhancement adds paid offline eligibility, secure manual-member welcome, a separate platform owners invitation and private QR uploads. See [Manual member welcome and groups](MANUAL_MEMBER_WELCOME_AND_GROUPS.md) for current behavior, deployment and verification. Its rules supersede the older offline limitation below.

Owners configure **Gym Profile → Communication → WhatsApp Group / Channel**. This is an opt-in, link-only feature. They create the destination, approve members and publish updates in WhatsApp. Existing manual-message group settings and Cloud API connections remain independent.

## Settings and private APIs

- `Gym.whatsappUpdates`: `enabled`, `type` (`group`/`channel`), `displayName`, `inviteUrl`, `description`, `version`, `updatedAt`, `updatedBy`. The entire subdocument is `select: false`. Existing gyms need no backfill and remain disabled.
- Owner `GET`/`PATCH /api/v1/owner/communication/whatsapp-updates`: requires owner role, gym read/update permission, active gym context, and matching `Gym.ownerId`. Changes record actor/time and increment the configuration version atomically. Only editable fields are accepted.
- Member `GET /api/v1/users/me/subscriptions/:publicId/whatsapp-updates`: authenticated subscription detail subresource, checks the current entitlement every time. Returns an invitation or `null`; other users' or platform subscriptions return 404. Responses use `Cache-Control: private, no-store`.
- Member page: `/app/profile?section=membership&membership=<subscription-public-id>`. The link appears under the relevant membership. Each query is scoped to account/session/membership, is not persisted, and revalidates on focus. GETFIT4U does not store joined/followed status.

Both server and client parse URLs and allow only HTTPS `chat.whatsapp.com/<code>` or `[www.]whatsapp.com/channel/<id>`. Optional trailing slashes and the group share-sheet `mode` parameter are supported. Credentials, explicit ports, percent encoding, path traversal, unknown query parameters, fragments, lookalike hosts, shorteners and unsafe schemes are rejected. Identifiers retain case; no guessed fixed token length is imposed. Validation checks format, not existence or ownership. The server never fetches an invite URL.

Official references checked during implementation: [WhatsApp group invitations and resetting links](https://faq.whatsapp.com/3242937609289432/), [WhatsApp Channels](https://www.whatsapp.com/channels), [official channel URL](https://www.whatsapp.com/channel/0029Va4K0PZ5a245NkngBA2M/), [reset-link troubleshooting](https://faq.whatsapp.com/1010627070036599/).

## Purchase and eligibility

The existing verified Razorpay `payment.captured` / `order.paid` transaction continues to create the membership, invoice and deduplicated `membership.activated` or `membership.renewed` notification. That existing notification now records `metadata.membershipPurchaseConfirmed`. Inbox reads add gym-specific invitation wording when enabled, without adding another notification, changing its dedupe key, or sending a new WhatsApp API message. The original confirmation remains available if this optional enrichment fails. Push previews use the existing generic event copy and authenticated notification URL, never the private invitation.

The authenticated payment-status response exposes `membershipPublicId` only for a captured, fulfilled membership purchase with matching user/gym/subscription. Member checkout opens `/payment-return?paymentId=<payment-public-id>`. This screen reads server status, shows the confirmed gym/plan/dates, preserves invoice actions, provides the invitation and always offers **Continue to Membership**. Callback/query-string success alone does not unlock the invitation. Invitation loading has its own retry; it cannot roll back payment or fulfillment.

Eligibility requires all of:

- Subscription belongs to the signed-in user and is `GYM_MEMBERSHIP`.
- Status is `ACTIVE` or `FROZEN`, with an end date in the future.
- Corresponding member profile is active, not deleted, and belongs to the same user/gym.
- Its linked latest payment is Razorpay, `MEMBERSHIP`, `CAPTURED`, `fulfillmentStatus: APPLIED`, and matches the same payer/gym/subscription.
- Gym is active, not deleted, and has an enabled valid invitation.

Paid future-start memberships may receive pre-start announcements. Frozen memberships may continue receiving updates. Neither exception grants early/frozen attendance access. Grace, expired, cancelled, deactivated, pending, free/trial and admin-authorized unpaid memberships do not qualify. Refund states do not qualify. Optional offline-payment invitation access is not enabled in this initial implementation.

## Notification routing fixes

The recipient-scoped `/api/v1/users/me/notifications/:id/open` resolver now distinguishes member versus platform renewals, owner join requests, gym status updates, class bookings, ordinary chat, inbound WhatsApp, reviews and announcements. Announcements/campaigns open their own inbox detail using `?notification=<id>` rather than an unrelated gym billing page. Legacy profile redirects preserve record IDs, search parameters, hash and navigation state. Record-specific views ignore old list search/date/status/page filters. Cross-role or inactive-gym context mismatches receive an explanation rather than silently opening the wrong workspace. Notification lookup caches include account, session, role and gym context.

## Operational limits

The invitation opens only after clicking a normal HTTPS link, with `target="_blank" rel="noopener noreferrer"`; Copy Link is available. Group members see other members' phone numbers. Channels have separate follower/privacy behavior and are not a GETFIT4U-enforced private membership gate. No launch or return event counts as joining, and no membership access depends on joining.

Links can be forwarded. Disabling/replacing a link in GETFIT4U does not revoke previously copied links; the owner must reset/revoke the link in WhatsApp. Approval, full groups, reset links, installation/web fallback and notification settings are controlled by WhatsApp/device behavior. Owners handle removal manually and should retain essential information in existing GETFIT4U channels. There is no scraping, participant synchronization, browser automation or automated group posting.

## Validation

Regression tests cover URL validation, owner isolation/editing/disable/remove, private projection, captured/fulfilled entitlement filtering, cross-account/platform denial, frozen/future and expired states, notification destinations and failure isolation, group/channel actions, account cache switching, payment-success navigation, and existing checkout/membership behavior. Unit/component tests mock API/database boundaries; they do not prove live Razorpay settlement, actual WhatsApp joining or device/PWA rendering. Live-provider, database end-to-end and physical-device checks require separate verification.

Results on 13 November 2026:

- Backend `npm test -- --maxWorkers=4`: **109 files / 873 tests passed**.
- Final affected frontend suite: **11 files / 107 tests passed**, including invitations, settings, payment return/checkout, memberships, notification inbox/open, profile redirects, payment tables and authentication return links.
- Full frontend exploratory run: **658/660 passed**. The payment-table test expected filtering to hide a notification's selected payment; it was updated to check exact-record routing and filtering after “Show all”, and passed on rerun. The other failure is the pre-existing `MessagesPage.test.tsx` source-aware back-link assertion: its button is already commented out in the checked-in component. That unrelated UI choice was preserved.
- Backend and frontend production builds (including TypeScript) and both ESLint checks passed.
- `git diff --check` passed. A targeted secret-pattern scan of changed source/documentation found no matches. A dedicated secret scanner was unavailable; no dependency vulnerability audit or live-provider/device/database end-to-end test was run.

Main implementation files:

- Backend: `models/Gym.ts`, `services/whatsappUpdatesService.ts`, `utils/whatsappInvite.ts`, `controllers/whatsappUpdatesController.ts`, `routes/ownerRoutes.ts`, `routes/userRoutes.ts`, `controllers/checkoutController.ts`, and the two notification destination/link services.
- Frontend: `WhatsAppUpdatesSettings`, `MembershipWhatsAppUpdates`, `GymProfileEditor`, `PaymentReturnPage`, `PaymentCheckout` in `LivePublic`, `MemberSubscriptions`, `NotificationsApiPage`, `NotificationOpenPage`, `LiveWorkspace`, `ResourcePage` in `LiveData`, `ProfileSectionRedirect`, authentication return-link validation and `whatsapp-updates.css`.
- New and updated regression tests accompany these flows. The isolated coordinated-check script's gym activation destination expectation was updated; that database script was not executed in this run.
