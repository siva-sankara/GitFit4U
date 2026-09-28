# Notification delivery and recovery

The existing MongoDB `Notification` collection is the durable inbox and push queue. Business handlers call `emitDomainEvent` (or the bounded `emitDomainEvents` batch) with a stable entity/occurrence identifier. Insert-only upserts and the unique user/dedupe index preserve read, deletion and delivery state on retries. Transactional business handlers pass their database session; notification delivery runs only after commit.

## Renewal reminders

The existing server maintenance job scans subscriptions in bounded cursor batches. Eligible current memberships receive at most one reminder per gym-local calendar date, from seven calendar days before the expiry date through seven calendar days after it. The expiry date itself is included. There is no missed-day backfill or browser dependency. Dates use each gym's configured IANA timezone, including daylight-saving changes.

Each key includes the subscription, exact expiry timestamp and local schedule date. Renewing or changing the expiry timestamp starts a new cycle. A superseded subscription, frozen/cancelled membership, deactivated member or archived/suspended gym cannot schedule member reminders. A naturally expired subscription can remind an otherwise active member. Platform renewal reminders remain available when the gym is inactive because its platform subscription expired.

The scheduler takes the same subscription/member/gym write locks as relevant business updates and records a `notification.reminder.scheduled` audit event with the date and expiry cycle. Pending push reminders are checked against current membership state before delivery. Already delivered history is retained; deleting its inbox copy does not reschedule it.

## Firebase and multiple devices

Backend sending uses Firebase Admin SDK subpath imports, server-only service-account credentials and the existing `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` settings. The web app uses its existing `VITE_FIREBASE_*` public configuration and VAPID public key. Enable FCM for the project, configure its web push key and authorized application domains, and serve the app over HTTPS (localhost is permitted for development). Never place the service-account key in frontend environment variables.

Device tokens are authenticated registrations, never authentication credentials. Each is bound to a user, login session and optional browser installation ID. Rotation deactivates earlier tokens for that browser; current-session revocation does not disable another device. Delivery rechecks account preferences, live sessions and device consent. Invalid tokens are deactivated; transient errors retry with backoff under a database lease. Per-device delivery hashes prevent routine duplicate sends. Provider acknowledgement loss can still produce at-least-once delivery: stable OS notification tags and browser ID tracking minimize duplicate display and sound.

Mongo change streams publish committed notification IDs to authenticated socket rooms on each API node. Clients fetch details through the authorized notification endpoint. Inbox polling remains the recovery path during stream interruption. MongoDB must support replica-set transactions/change streams. The existing startup requirement already uses transactions.

## Browser interaction

Push settings report browser permission and current-session registration separately. Permission is requested only after a user action. Denied permission directs the user to browser settings. Sound is an account-saved, default-off opt-in; playback respects browser autoplay restrictions. Read/deleted notifications do not trigger foreground sound. FCM, socket and inbox polling share the notification-ID tracker, and rapid updates are sound-throttled. Background web notifications are silent unless sound was enabled.

Push content is privacy-safe central event copy. Rich renewal details and benefits stay inside the authenticated inbox. Same-origin message links use `/messages/{conversationId}`; authentication must complete before the role-specific conversation redirect. Existing tabs receive a service-worker navigation message; new tabs open the safe local destination.

## Retention and upgrade

Notification deletion sets `archivedAt` and stops pending push; it does not delete payments, memberships, conversations or audits. Delete All requires explicit confirmation and is always scoped to the authenticated user. Chat archive is likewise per participant, with a paginated Archived chats view and explicit Restore. New messages do not remove another participant's archive choice.

Run the existing `npm run db:migrate` in the controlled deployment maintenance window to add notification inbox/device indexes. It preserves records and stops on conflicting notification dedupe keys. Existing legacy support migration remains additive. No production migration, real push send or real-recipient campaign is required by unit tests.
