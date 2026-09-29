# GETFIT4U WhatsApp Cloud API integration

Status date: 2026-09-29

This integration is an additive channel. Internal chat, in-app notifications, Firebase push, email, SMS verification, payment, booking, membership, attendance, media and account flows remain authoritative and independent. WhatsApp failures are recorded in a separate durable outbox and never undo the committed business operation.

## Readiness status

| Gate | Status | Evidence or remaining action |
| --- | --- | --- |
| Code and schema | Implemented | Tenant-bound connections, consent, conversations, messages, outbox, webhook receipts, templates, campaigns and onboarding sessions |
| Local configuration | Operator action required | Populate server-only environment values and run the dry-run migration |
| Meta account eligibility | External action required | Meta business/app verification, app review, WABA/phone eligibility, display name, billing and Embedded Signup configuration |
| Templates | External action required | Submit the catalog below in each applicable WABA; approval is not implied |
| Live provider verification | Not performed | Requires approved assets, credentials and explicitly authorised test recipients |
| Real-device certification | Not performed | Complete the checklist in “Live certification” for platform and at least one gym sender |

Do not set `WHATSAPP_MODE=live` until every required external gate is complete. A successful API request means provider acceptance, not delivery or read.

## Sender architecture

There are two isolated scopes:

- `PLATFORM` resolves only binding key `PLATFORM` and uses GETFIT4U’s official sender. It does not fall back to a gym sender.
- `GYM` resolves only binding key `GYM:<authorized gym ObjectId>` and uses that gym’s connected phone-number identity. It does not fall back to the platform or another gym.

Every conversation, message and outbox row retains the original `connectionId`, scope and gym. A WABA alone is not a sender identity; `phoneNumberId` is unique across all bindings. The frontend never supplies credentials or selects an arbitrary sender.

Credentials returned by Embedded Signup are exchanged server-side and stored using AES-256-GCM with `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY`. The UI receives only safe connection metadata. Rotate a sender by reconnecting; never put gym tokens in `.env` or browser configuration.

## Environment

Names only are committed in `backend/.env.example`:

```text
WHATSAPP_MODE=disabled
WHATSAPP_APP_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_API_VERSION=v26.0
WHATSAPP_DEFAULT_LANGUAGE=en_US
WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=
WHATSAPP_COEXISTENCE_ENABLED=false
WHATSAPP_COEXISTENCE_CONFIG_ID=
WHATSAPP_CREDENTIAL_ENCRYPTION_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
WHATSAPP_WEBHOOK_RETENTION_DAYS=30
WHATSAPP_WORKER_ENABLED=false
```

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_WABA_ID` bootstrap only the platform connection and are optional for gym onboarding. App Secret, webhook verify token and access tokens are different credentials.

Modes:

- `disabled`: no business event is queued and connection setup is unavailable. Other channels operate normally.
- `dry_run`: policy/outbox paths can be exercised, but dispatch is suppressed before a provider send.
- `live`: provider requests are allowed after sender-specific outbound enablement. Required server configuration is validated at process startup.

The Graph version is configuration-pinned. Confirm it against Meta’s current version lifecycle before every upgrade; do not silently change it in production.

## Existing WhatsApp Business App number (Coexistence)

Coexistence is an optional Embedded Signup v4 path for an eligible phone number that is already active in the WhatsApp Business mobile app. It is separate from the standard Cloud API onboarding path. GETFIT4U does not promise eligibility, approval, history transfer, or uninterrupted service because Meta and the business owner control those decisions.

The owner-facing connection choices are:

- **Connect existing WhatsApp Business**: launches Embedded Signup with `featureType=whatsapp_business_app_onboarding`. No legacy `sessionInfoVersion` override is sent. The owner completes Meta's screens and keeps control of any backup/history-sharing choice.
- **Connect a separate business number**: launches the existing standard Embedded Signup flow without the Coexistence feature type.

The browser sends only the short-lived authorization code and the allowlisted Embedded Signup completion event. The server binds the onboarding session to the authenticated user, role, gym, mode, state hash and expiry; exchanges the code; validates the token app and scopes; enumerates authorized assets; and requires explicit phone selection when Meta does not return one. A browser-supplied WABA or phone ID is never trusted by itself. Repeated callbacks and retries use the same session and connection binding.

Coexistence connections deliberately start with outbound paused while subscription, webhook echo/history processing, template sync and a controlled test are verified. GETFIT4U never calls a phone registration or deregistration endpoint during this path. Owner-sent Business App messages are ingested from `smb_message_echoes` as outbound transcript records and are never re-enqueued. Imported history keeps the provider timestamp and is not treated as a fresh inbound message, opt-in, notification event, or new 24-hour service window. Declining history sharing is a supported limited state, not an onboarding failure.

Enable the feature only after the Meta app is ready:

1. Create or update a Facebook Login for Business Embedded Signup v4 configuration that supports WhatsApp Business App onboarding. Set its public ID in `WHATSAPP_COEXISTENCE_CONFIG_ID` (or intentionally use the baseline config after verifying it contains that feature).
2. Obtain the required access for `whatsapp_business_messaging` and `whatsapp_business_management`. Do not add a local "business verified" blocker; Meta remains authoritative for account and number eligibility.
3. Configure the deployed HTTPS frontend origin and the Meta OAuth/Embedded Signup domains. The application CSP allows only the required Meta SDK, frame and connection origins.
4. Subscribe each authorized WABA to the app and subscribe the webhook to `messages` and `smb_message_echoes`. Keep the callback at `https://<api-host>/api/v1/webhooks/whatsapp` and retain signature validation.
5. Deploy the additive model/index changes with `WHATSAPP_COEXISTENCE_ENABLED=false`, run the migration, validate the standard path, then set the feature flag to `true` for a controlled gym cohort.
6. Complete the real-device checklist below with a backup of the Business App data and an owner-approved test number before production rollout.

Safe rollback is to set `WHATSAPP_COEXISTENCE_ENABLED=false` and redeploy. This disables new Coexistence launches but does not disconnect existing connections, delete imported history, alter the Business App number, or affect the standard-number onboarding path. Pause an individual sender with its existing outbound control if incident containment is required.

## Meta setup runbook

1. In the existing Meta developer app, confirm the GETFIT4U business portfolio owns or is authorised for the platform WABA.
2. Complete the current Meta business verification and any App Review/Data Use Checkup required for the implemented permissions. Approval is controlled by Meta and is not automatic.
3. Add WhatsApp, register the production phone, complete display-name review, confirm phone/account quality and attach the correct billing method. Development/test-number restrictions still apply until Meta removes them.
4. Request only `whatsapp_business_messaging` and `whatsapp_business_management` for the baseline. Add no broader permission unless a reviewed feature needs it.
5. Create the Tech Provider Embedded Signup v4 configuration in the same app. Use the official supported flow, allowed domains and the deployed HTTPS origin. Put its public configuration ID only in server configuration; the API returns it to an authenticated connection screen when needed. Configure the optional Coexistence path separately as described above.
6. Configure the webhook callback as `https://<api-host>/api/v1/webhooks/whatsapp`. Set the same random server-only value in Meta and `WHATSAPP_VERIFY_TOKEN`. Subscribe the app/WABAs to `messages` and, when Coexistence is enabled, `smb_message_echoes`. The connection service also calls `subscribed_apps` after validating the returned assets.
7. Set the App Secret and a separate 32+ character credential-encryption key in the deployment secret manager. Never paste them into source, frontend variables or logs.
8. Submit the required templates in the platform WABA and separately in each gym WABA. Sync them from GETFIT4U after provider review.
9. Run `npm run db:migrate-whatsapp` from `backend` (dry-run), resolve any binding conflicts, then run `npm run db:migrate-whatsapp -- --apply` in a maintenance window.
10. Set `WHATSAPP_WORKER_ENABLED=true` only on the dedicated worker deployment, then deploy the API and that continuously running worker. On Docker Compose the `whatsapp-worker` service runs `npm run start:whatsapp-worker`. A Vercel/API deployment alone does not run this worker; deploy the worker to a durable container/process platform.
11. Start in `dry_run`, validate signed webhook receipts and policy decisions, then test a controlled platform sender. Repeat with one gym sender before expanding rollout.

Before onboarding a number used by another API provider, check Meta's current migration eligibility and use a separately approved migration runbook. Coexistence applies specifically to eligible WhatsApp Business App numbers; it is not a generic provider migration. Do not deregister or migrate any number automatically.

Official references:

- Meta Graph API versions: <https://developers.facebook.com/docs/graph-api/changelog/versions/>
- Meta WhatsApp Cloud API collection: <https://www.postman.com/meta/whatsapp-business-platform/overview>
- Meta Embedded Signup collection: <https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup>
- Meta WABA app subscription request: <https://www.postman.com/meta/whatsapp-business-platform/request/0yubu4i/subscribe-app-to-whatsapp-business-account>
- Meta Unified Onboarding/Embedded Signup v4 overview: <https://developers.meta.com/resources/videos/unified-onboarding-whatsapp/>
- WhatsApp Messenger to WhatsApp Business owner-controlled transition: <https://faq.whatsapp.com/3059780464322392/>
- Meta webhook collection: <https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks>
- Embedded Signup implementation: <https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation>

## Data model and retention

- `WhatsAppConnection`: immutable tenant binding, sender assets, encrypted credential, connection/quality state, event controls, caps, quiet hours and kill switch.
- `WhatsAppConsent`: per connection and hashed contact, separate service/marketing evidence, wording version, withdrawal and inbound opt-out.
- `WhatsAppConversation`: sender-scoped contact identity, optional verified user link, last genuine inbound timestamp, unread/archive state.
- `WhatsAppMessage`: direction/source, provider ID, content/template metadata and independent lifecycle timestamps.
- `WhatsAppOutbox`: stable dedupe key, original sender scope, recipient, expiry, lease, attempts, policy decision and result.
- `WhatsAppWebhookReceipt`: signed raw-event normalization, durable lease and configurable TTL (default 30 days).
- `WhatsAppTemplate`: per-connection WABA/name/language status and components.
- `Campaign`: the existing model is reused with `channel=WHATSAPP`; delivery remains individual, consent-filtered and bounded.

Provider IDs are strings. Unique indexes cover tenant bindings, phone-number bindings, provider message IDs, consent scope and dedupe keys. Transcript/content retention and deletion must follow the approved GETFIT4U privacy schedule. Keep minimal suppression evidence after an account deletion if legally approved and necessary to prevent re-contact. Never log tokens, full phone numbers, message bodies, invoice contents or activation links.

## Consent and policy

Users enable WhatsApp separately for each connected business. Service and marketing choices are independent; marketing starts unchecked and is optional. A platform opt-in never authorises a gym, and Gym A never authorises Gym B. Imported/owner-created members receive no fabricated opt-in.

`STOP`, `UNSUBSCRIBE`, `CANCEL`, `END` and `QUIT` withdraw both purposes for that exact sender/contact and suppress queued jobs. Reconnection, renewal or import does not restore consent. An explicit settings re-opt-in creates new evidence.

Free-form outbound text is permitted only when the conversation has a genuine inbound message within the previous 24 hours. Delivery/read/internal events do not update `lastInboundAt`. Outside that window the UI and dispatch policy require an approved template. Consent does not bypass this rule.

Immediately before every send, the worker rechecks mode, expiry, original sender binding, connection/kill switch, concurrency, consent, service window, template approval/category/language, quiet hours, daily/monthly caps and per-recipient frequency. Provider timeouts during submission become `UNKNOWN_OUTCOME` and are not blindly resent.

## Event-to-channel matrix

WhatsApp is proposed only for the events below. All existing notification channels continue under their own preferences. Attendance stays in-app/push by default.

| Scope | Events | Template |
| --- | --- | --- |
| Platform | account registration | `gfu_account_welcome` |
| Platform | platform subscription expiring | `gfu_platform_subscription_expiring` |
| Platform | gym activated/suspended/archived | `gfu_gym_status_updated` |
| Gym | account verified/member invitation | `gfu_member_invitation` |
| Gym | membership created/activated/frozen/reactivated/deactivated/expiring/expired/cancelled/renewed | Matching `gfu_membership_*` template |
| Gym | payment successful/offline/refunded, invoice ready | `gfu_payment_confirmed`, `gfu_offline_payment_recorded`, `gfu_refund_updated`, `gfu_invoice_available` |
| Gym | class booked/reminder/cancelled/updated/trainer changed | Matching `gfu_class_*` template |
| Dynamic | support updated | `gfu_support_updated` from the related gym sender when gym-scoped, otherwise platform |
| Gym | trainer assigned | `gfu_trainer_assigned` |

Operators can disable individual automated events per sender. Enabling WhatsApp does not replay historical events.

## Submission-ready template catalog

These are proposals, not approvals. Create each only in the WABA that will send it. Use `en_US` initially and add reviewed translations separately. Sensitive details stay behind authenticated GETFIT4U links.

| Name | Candidate category | Purpose and sample | Variables/buttons |
| --- | --- | --- | --- |
| `gfu_account_welcome` | Utility | “Your GETFIT4U account is ready.” | URL: Open GETFIT4U |
| `gfu_gym_status_updated` | Utility | “Your gym registration status changed. Review it securely.” | URL: View gym status |
| `gfu_platform_subscription_expiring` | Utility | “Your GETFIT4U platform subscription needs attention.” | URL: Review subscription |
| `gfu_platform_invoice_available` | Utility | “Your GETFIT4U invoice is available.” | URL: View invoice |
| `gfu_member_invitation` | Utility | “You were invited to join a gym on GETFIT4U.” | URL: Activate account |
| `gfu_membership_created` | Utility | “Your gym membership was created.” | URL: View membership |
| `gfu_membership_activated` | Utility | “Your gym membership is active.” | URL: View membership |
| `gfu_membership_frozen` | Utility | “Your gym membership is frozen.” | URL: View membership |
| `gfu_membership_reactivated` | Utility | “Your gym membership is active again.” | URL: View membership |
| `gfu_membership_deactivated` | Utility | “Your gym access status changed.” | URL: Contact gym |
| `gfu_membership_expiring` | Utility | “Your membership is nearing expiry.” | URL: Renew membership |
| `gfu_membership_expired` | Utility | “Your membership has expired.” | URL: View options |
| `gfu_membership_cancelled` | Utility | “Your membership was cancelled.” | URL: View membership |
| `gfu_membership_renewed` | Utility | “Your membership renewal is recorded.” | URL: View updated dates |
| `gfu_membership_renewal_reminder` | Utility | “Review your membership renewal options.” | URL: Renew membership |
| `gfu_payment_confirmed` | Utility | “Your payment is confirmed; your receipt is available.” | URL: View receipt |
| `gfu_offline_payment_recorded` | Utility | “Your gym recorded an offline payment.” | URL: View receipt |
| `gfu_invoice_available` | Utility | “Your invoice is ready.” | URL: Authenticated invoice screen |
| `gfu_refund_updated` | Utility | “Your refund status was updated.” | URL: View payment history |
| `gfu_class_booking_confirmed` | Utility | “Your class reservation is confirmed.” | URL: View booking |
| `gfu_class_reminder` | Utility | “Your booked class starts soon.” | URL: View booking |
| `gfu_class_cancelled` | Utility | “A booked class was cancelled.” | URL: View bookings |
| `gfu_class_updated` | Utility | “A booked class schedule or trainer changed.” | URL: View booking |
| `gfu_trainer_assigned` | Utility | “Your trainer assignment changed.” | URL: View trainer |
| `gfu_support_updated` | Utility | “Your support conversation has an update.” | URL: Open support |
| `gfu_gym_offer` | Marketing | “Your gym has an optional member offer.” | URL: View offer; marketing consent required |

Before submission, replace sample copy with approved business wording, declare every variable with representative non-sensitive sample data, configure the exact authenticated URL button, and validate parameter count/type. The current campaign UI intentionally allows only parameterless approved Marketing templates. Never misclassify promotions as Utility.

## API contracts

All routes below are under `/api/v1`. Except webhooks, they require the existing bearer session and server-side role/permission checks.

- `GET /whatsapp/connection`: current actor’s platform or selected-gym connection/configuration.
- `POST /whatsapp/onboarding/start`, `POST /whatsapp/onboarding/complete`, `POST /whatsapp/onboarding/:id/cancel`: state-bound Embedded Signup.
- `POST /whatsapp/connection/check`, `PATCH /whatsapp/connection/outbound`, `PATCH /whatsapp/connection/controls`, `DELETE /whatsapp/connection`.
- `GET /whatsapp/templates`, `POST /whatsapp/templates/sync`.
- `GET|PUT /whatsapp/preferences`: authenticated user’s per-business service/marketing choices.
- `POST /whatsapp/gym/members/:memberId/conversation`: selected gym only; no arbitrary-phone endpoint.
- `GET /whatsapp/conversations`, `GET /whatsapp/conversations/:id`, `GET /whatsapp/conversations/:id/messages`.
- `POST /whatsapp/conversations/:id/messages`, `POST /whatsapp/conversations/:id/read`, `PATCH /whatsapp/conversations/:id/archive`.
- `GET /whatsapp/campaigns`, `POST /whatsapp/campaigns/preview`, `POST /whatsapp/campaigns`, `POST /whatsapp/campaigns/:id/cancel`.
- `GET /whatsapp/diagnostics`: platform admin; safe metadata/counts only.
- `GET|POST /webhooks/whatsapp`: public Meta verification/signed event entry points, isolated from user authentication.

Mutation routes validate payloads and use a caller idempotency UUID where creation can repeat. Pagination is bounded. Errors use safe categories such as configuration missing, token/permission invalid, sender disconnected, template unavailable, parameter mismatch, consent missing, outside service window, rate/budget limit, recipient/provider failure and unknown outcome. There is no unrestricted “send to phone” endpoint.

## Webhook and delivery operations

The POST webhook receives exact raw bytes before global JSON parsing and validates `X-Hub-Signature-256` with HMAC-SHA256 and the App Secret using constant-time comparison. The GET challenge uses the separate verify token. Valid payloads are persisted before HTTP 200, then processed by leased workers. Batches, retries and every `entry/change` are processed; unknown phone-number bindings are logged without fallback.

Inbound messages update the 24-hour window and route by receiving `phone_number_id`. Unknown contacts create only a tenant-scoped inbox thread; they do not create accounts or disclose records. Media metadata is recorded, but automatic media fetching is intentionally not enabled until a private download, malware scanning/quarantine and type/size validation pipeline is approved.

Outbound lifecycle is `QUEUED -> SENDING -> ACCEPTED -> SENT -> DELIVERED -> READ`. `FAILED`, `SUPPRESSED`, `CANCELLED`, `EXPIRED` and `UNKNOWN_OUTCOME` are explicit alternatives. Out-of-order/replayed statuses cannot regress or double-count. WhatsApp read state is separate from internal chat read state.

Operational checks:

1. Alert on webhook receipts in `FAILED`, old `RECEIVED`, outbox `UNKNOWN_OUTCOME`, growing `QUEUED`, restricted connections and template sync age.
2. Use `GET /whatsapp/diagnostics` for redacted connection/outbox/webhook counts; inspect structured logs by event/message/connection reference.
3. Keep inbound webhook processing active when outbound is paused so opt-outs and statuses are not lost.
4. Provider availability must not be part of the global `/health` restart decision.

## Live certification

Use controlled, explicitly authorised recipients only. Record evidence separately for sandbox and production:

- [ ] Platform sender identity and assets verified.
- [ ] One gym-owned sender identity and assets verified.
- [ ] Standard separate-number Embedded Signup remains functional.
- [ ] Eligible Business App number completes Coexistence onboarding without a registration/deregistration operation.
- [ ] Business App remains usable after connection and an app-sent message arrives once as an outbound echo.
- [ ] History accepted/declined outcomes are reflected accurately; imported history creates no opt-in, notification or 24-hour-window side effect.
- [ ] Duplicate, reordered and retried code/session callbacks create only one tenant binding.
- [ ] Per-business consent recorded.
- [ ] Approved Utility template accepted; provider ID stored.
- [ ] Sent/delivered webhook processed and message received on a real device.
- [ ] Recipient reply appears only in the correct tenant inbox.
- [ ] Staff free-form reply succeeds within the 24-hour window.
- [ ] Outside-window free text is blocked and an approved template succeeds.
- [ ] STOP withdraws both purposes and suppresses a queued automation.
- [ ] Authenticated invoice/booking link opens only the correct account record.
- [ ] Gym A/Gym B sender and transcript isolation verified with a multi-gym controlled account.
- [ ] Email, push, in-app messaging, SMS verification, payment, booking, membership, invoice and attendance regressions pass.
- [ ] No read receipt is fabricated when Meta does not provide one.

## Rollout and rollback

Roll out additive indexes with mode disabled, then dry-run event evaluation, signed webhook ingestion, controlled platform tests, controlled gym tests, limited transactional events, broader approved events, and finally marketing after separate approval. Use sender kill switches and event controls.

Rollback:

1. Pause outbound per sender or set `WHATSAPP_MODE=disabled` and restart API/worker.
2. Stop the worker only after outbound is paused; if possible keep webhook ingestion/processing running for statuses and opt-outs.
3. Cancel pending campaigns. Pausing/disconnecting cancels queued sends without deleting transcripts, consent or unrelated gym data.
4. Do not delete outbox/receipt history and do not replay old business events after recovery.
5. Restore through Check Connection, template sync and controlled tests before re-enabling outbound.

Disconnect removes the stored credential and stops queued work for that connection. Provider-side asset revocation may still require Meta Business settings. This procedure never deletes a gym, membership, payment or internal conversation.
