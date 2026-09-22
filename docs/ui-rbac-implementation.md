# UI, active-role routing and notifications implementation

## Implementation sequence and affected files

1. **Unify session and route protection.** [session.ts](../frontend/src/services/session.ts) defines the shared typed session response and refresh flow; [api/hooks.ts](../frontend/src/api/hooks.ts) uses that same query. [ProtectedRoute](../frontend/src/routes/ProtectedRoute.tsx) redirects guests to `/login`, retains safe destinations, and replaces wrong-role routes with the active dashboard. [GuestRoute](../frontend/src/routes/GuestRoute.tsx) keeps authenticated users out of public/auth screens. [SessionFailure](../frontend/src/routes/SessionFailure.tsx) lets revoked sessions log out safely instead of retrying indefinitely.
2. **Introduce canonical routes without breaking bookmarks.** [App.tsx](../frontend/src/App.tsx) and [AuthDesktopPage](../frontend/src/pages/public/AuthDesktopPage.tsx) implement `/login`, `/register` and protected `/profile`. [LegacyAuthRedirect](../frontend/src/routes/LegacyAuthRedirect.tsx) preserves query, hash and state while replacing old auth URLs. [authRedirect.ts](../frontend/src/services/authRedirect.ts) restricts return destinations to known local routes and the active role. Existing gym/plan return intents remain supported.
3. **Flatten navigation and standardize layout.** [WorkspaceLayout](../frontend/src/layouts/WorkspaceLayout.tsx) derives navigation from the server session's active role and permissions. The role dropdown is removed. User names link to `/profile`, the duplicate Profile menu item is removed, and owner Campaigns/Invoices entries are temporarily commented out. [workspace-navigation.css](../frontend/src/styles/workspace-navigation.css) standardizes headings, profile controls, unread badges, responsive navigation, contrast and table containment. The verified-registration transition to owner access remains intact.
4. **Restore membership information and responsive states.** [LiveWorkspace](../frontend/src/pages/live/LiveWorkspace.tsx), [LiveData](../frontend/src/pages/live/LiveData.tsx), [StatusBadge](../frontend/src/components/StatusBadge.tsx), [MemberSubscriptions](../frontend/src/pages/user/MemberSubscriptions.tsx), [member-workspace.css](../frontend/src/styles/member-workspace.css) and [status-badge.css](../frontend/src/styles/status-badge.css) provide owner member columns, color-coded states, compact Gym Status typography, paginated subscription cards, loading/empty/error states and action progress. Confirmed membership changes update their cache immediately and refresh only related resources in the background. Pending memberships link back to the selected plan; they never grant access based on a client payment callback.
5. **Keep data access scoped and permission checked.** [workspaceRoutes.ts](../backend/src/routes/workspaceRoutes.ts) batches attendance counts for the displayed member page and returns payment status only with financial permission. [ownerController.ts](../backend/src/controllers/ownerController.ts) excludes revenue queries and fields without `finance:read`. Restricted staff see operational dashboards without forbidden summary requests. [authController.ts](../backend/src/controllers/authController.ts) validates the stored active role and assignment before creating a session, falls back only to an explicitly assigned member role, and otherwise returns a clear access error before issuing credentials.
6. **Repair alerts and the notification screen.** [firebasePush.ts](../frontend/src/services/firebasePush.ts), [notificationAlerts.ts](../frontend/src/services/notificationAlerts.ts), [AppContext](../frontend/src/context/AppContext.tsx), [PushNotificationSettings](../frontend/src/components/PushNotificationSettings.tsx), [NotificationsApiPage](../frontend/src/pages/shared/NotificationsApiPage.tsx) and [notifications.css](../frontend/src/styles/notifications.css) implement deduplicated foreground alerts, a visible-tab inbox refresh fallback, the included sound, mute/preview controls, typed notification records, filters, pagination, details and clear loading/error states.

## Configuration and assets

The original sound asset is included at [frontend/public/sounds/notification.mp3](../frontend/public/sounds/notification.mp3), served as `/sounds/notification.mp3`. There is no new audio dependency.

The six web Firebase values below were missing or empty in `frontend/.env` during verification. Obtain the public Web App configuration and VAPID public key from the same Firebase project as the backend:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

The existing backend `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` and `CLIENT_ORIGIN` values are present. Presence alone does not verify provider credentials or delivery. No environment values were changed. Keep the service-account private key on the backend.

Restart Vite after adding frontend environment values, or rebuild and redeploy production. Enable browser notifications from the Notifications screen on HTTPS or localhost. Use **Test sound** after interacting with the page. Browser autoplay policy may block automatic sound before interaction; the custom MP3 plays in the focused visible tab, while background/closed-tab notification audio is controlled by the browser/OS. See [Firebase setup and delivery checks](firebase-notifications.md).

No schema/data migration is introduced by this change. Existing production deployments still need the previously documented notification queue indexes. No real payment, push send, registration or member data was created during these checks.

## Validation

- Frontend: 146 tests across 21 files passed, including auth aliases, active-role restrictions, Back navigation, revoked-session recovery, profile links, permissions, member columns, subscription loading/actions, notification deduplication and settings.
- Backend: 46 tests across 10 files passed, including session-role resolution, operational/financial dashboard separation, tenant-scoped member attendance and payment-field permissions.
- Frontend strict TypeScript/Vite production build and backend TypeScript build passed.
- Rendered owner Members/Dashboard and member Subscriptions/Notifications using isolated browser fixtures. No production API responses or database records were altered. Members table containment checked at 320, 390, 900 and 1440 pixels; subscriptions and notifications checked at 390 and 1440 pixels.
- Firebase tests simulate delivery. Live browser/device delivery must be checked after providing the missing frontend configuration.

## Design-reference limitation

The supplied `https://getfit4u.kenguva-tirupati.chatgpt.site/owner/members` address is a hosted site, not a Figma document URL. Its server returned HTTP 401 Unauthorized. Exact Figma fidelity could not be verified. Styling follows the repository's existing typography, spacing, colors and component conventions; a publicly accessible reference or authorized screenshot is needed for exact comparison.

## Manual acceptance checks

1. Signed out, open `/owner/members` or `/profile`: expect `/login` with a safe return destination. Complete login using an authorized test account and confirm the correct active dashboard or permitted destination.
2. Signed in, open `/login`, `/register` and legacy auth links; press Back/Forward through a landing-to-gym-to-login flow. Verify no private content appears signed out and no auth/public page replaces a signed-in workspace.
3. Click the user name to open `/profile`. Confirm the role dropdown and duplicate profile navigation are absent, and owner Campaigns/Invoices entries are hidden.
4. Inspect owner member columns, scroll the table horizontally on narrow screens, and compare restricted staff permissions. Staff without financial access must not receive payment/revenue fields from the API.
5. Open subscriptions with no records, active/expired/pending records and slow or failed requests. Confirm loading states, disabled submitting actions, retry controls, safe pending-payment continuation and immediate feedback after a confirmed membership action.
6. After Firebase configuration, enable notifications on your own account, preview the sound, verify one foreground alert per notification ID, test mute, test a background notification click, then disable notifications. Provider delivery and browser permissions need live verification on that authorized device.
