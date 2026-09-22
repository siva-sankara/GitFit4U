# Firebase push notifications

Firebase Cloud Messaging (FCM) runs alongside the existing database-backed notification inbox. New membership, workout, referral and campaign notifications are queued in MongoDB. The API process polls every 10 seconds after transactions commit. Delivery failures never roll back a payment or remove an in-app notification.

## Configuration

Use the same Firebase project for both applications. In Firebase Console, add a Web app and copy its public configuration to `frontend/.env`:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

Get the VAPID **public key** from Project settings ? Cloud Messaging ? Web Push certificates. Enable the Firebase Cloud Messaging HTTP v1 API (and the FCM Registration API if disabled in an existing project). Use a supported browser over HTTPS; localhost is supported for development. On iOS, web push requires a supported installed Home Screen web app.

Configure the service account in `backend/.env` or your deployment's secret manager:

```dotenv
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"
CLIENT_ORIGIN=https://your-frontend.example
```

The service account must have permission to send FCM messages for that project (Firebase Cloud Messaging API Admin / `cloudmessaging.messages.create`). Keep the private key exclusively on the backend. Do not prefix it with `VITE_`, place it in public assets, or commit it. For multiple allowed origins, `CLIENT_ORIGIN` is comma-separated; the first is the canonical notification-click origin.

Restart the API after backend environment changes. Restart Vite in development, or rebuild/redeploy the frontend for frontend environment changes. The Firebase worker is bundled from installed SDK dependencies with the web configuration; no CDN worker edits are required. Its separate scope preserves the existing offline worker.

## Member and owner flow

1. Log in and open your workspace's **Notifications** screen.
2. Click **Enable browser notifications** and accept the browser permission prompt. Permission is never requested automatically.
3. The device token is saved through the authenticated `/api/v1/devices` endpoint. Tokens refresh on later sign-ins and when the window regains focus.
4. Foreground messages show an in-app toast, refresh the notification inbox/badge, and play `/sounds/notification.mp3` in the focused tab. The same database notification ID is deduplicated across repeated FCM callbacks and inbox refreshes. A visible signed-in app also refreshes the inbox every 30 seconds so in-app alerts work without browser push permission. The initial inbox load does not replay historical alerts. Background messages show a browser notification once. Clicking opens its local action URL, or `/notifications`, which resolves to the signed-in role's inbox. Login preserves this destination.
5. **Disable browser notifications** revokes this device. Server-side logout revokes devices for the session, logout-all revokes all the user's devices, and expired sessions are excluded from delivery.

Missing configuration, unsupported browsers, blocked permissions and setup errors are shown in notification settings. In-app notifications continue to work.

## Alert sound

The original MP3 asset is included at `frontend/public/sounds/notification.mp3`; no additional environment variable or audio provider is required. The **Alert sound** switch saves a per-browser mute preference, and **Test sound** previews the file directly from a user action. Browsers may block automatic audio until the user interacts with the page or allows site audio; rejected playback never interrupts notification delivery. Custom MP3 audio plays only in the focused, visible app tab. When the app is closed or backgrounded, the browser/OS controls the notification sound; a service worker cannot play arbitrary audio files. See [browser autoplay rules](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

Failed initial device registration resets the opt-in state and presents a retry. A temporary reconnect failure preserves an existing opt-in. Foreground callbacks arriving after local opt-out or logout are ignored. Push configuration remains the same as above; tests simulate FCM and do not send real messages.

## Delivery and existing data

The queue uses atomic database leases, per-device success tracking, bounded retries with backoff, and invalid-token cleanup. `SENT` means FCM accepted the message, not that the person read it. `FAILED` can include partial delivery; the in-app record remains available. `SKIPPED` means no eligible devices or an update older than 24 hours. As with external delivery systems, a process failure immediately after provider acceptance can cause a repeat; notification tags reduce repeated browser displays.

Old notifications are not replayed or migrated. Old device records without a session are excluded until the browser registers again. No notification data migration is required. Development creates indexes automatically. Production disables automatic indexes: run the existing `npm run db:migrate` from `backend` during your deployment maintenance window to create the queue/session indexes before starting upgraded instances. That script also checks the existing notification deduplication index. MongoDB must be reachable and the API must remain running for delivery.

## Verification

- `frontend`: `npm test`, `npm run build`.
- `backend`: `npm test`, `npm run build`, `npm run test:push`.
- The push integration check creates and removes only a unique temporary database. Every Firebase send in that check is simulated; no real devices are notified.
- After configuration, verify on your own account: enable notifications, trigger an application event such as saving your referral invitation, check the foreground inbox update, repeat with the app in the background, open the notification, then disable push and confirm no new browser alerts. Do not infer live delivery from simulated tests.

References: [Firebase web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started), [foreground/background handling](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [FCM error handling](https://firebase.google.com/docs/cloud-messaging/error-codes).
