# Mobile app, theme and Profile delivery

## Implemented

- Light and Dark are the only UI choices. New/missing/invalid/legacy System browser preferences use Light; explicit Light/Dark remain unchanged. The synchronous `theme-init.js` applies the saved choice before React renders. There is no operating-system colour-scheme listener.
- The API accepts legacy System writes during rollout and normalizes them to Light. New users default to Light. Hydrated legacy users normalize before their next save, and the migration below updates stored legacy preferences without touching explicit choices or unrelated fields.
- User mobile tabs are Home, Book, Scan, Profile, Messages, linking to real existing pages. Other roles retain their permitted tabs. Safe-area padding, focus/pressed states and keyboard-aware tab hiding keep controls reachable.
- Profile has Overview, Membership, Bookings, Payments, Attendance, Workouts, Favorites, Referrals, Social and Settings. Personal details/photo editing opens from Edit profile. Existing class booking, membership lifecycle, invoice download, attendance/streak, social and account security components are reused. Known nested Profile paths redirect to the corresponding section while retaining invoice/deep-link parameters.
- Theme controls are hidden in mobile top bars. Users can change appearance and install the app from Profile → Settings; other roles have App settings on their own profile.
- The PWA manifest has a stable identity, `/app/home` authenticated start route, root scope, standalone display, PNG 192/512 icons, a separately padded maskable icon and an Apple touch icon. PNGs derive from the existing app SVG; no new branding or remote image dependencies were added.
- Installation uses the browser's `beforeinstallprompt` only after a user click. iOS/iPadOS, Android and desktop instructions cover browsers without that event. Installed display modes hide installation controls; dismissal is respected for 30 days and can be reversed in Settings.
- The offline service worker caches **only** `/offline.html`. API, message, invoice, upload and account responses are not added to Cache Storage. Failed navigations return an explicit 503 offline document; in-page offline status states that submissions are not queued.
- Worker cache identity changes with each changed production bundle. Updates wait; the user sees Save your work / Reload to update and must confirm reloading. Other tabs are not forced to reload. Retain old hashed deployment assets during a rolling deployment so already-open tabs can finish their work.
- PWA registration is `/sw.js` with scope `/`. Firebase retains the separate module worker with explicit `/assets/` scope and existing notification-click handling. No second notification listener or push registration was added to the PWA worker.

## Migration and compatibility

From `backend`, preview with:

```powershell
npx.cmd tsx src/scripts/migrate-light-theme.ts
```

After reviewing the count, apply with:

```powershell
npx.cmd tsx src/scripts/migrate-light-theme.ts --apply
```

The migration is idempotent and dry-run by default. It changes only missing/null/System `preferences.theme`. It has not been run against the configured database as part of this implementation. Explicit Light/Dark values are preserved. No environment variable or credential changes are needed.

## Deployment and verification scope

Serve the production frontend and API over HTTPS, with valid certificates and SPA fallback for direct/deep links. Serve manifest/icons/offline HTML as their actual files, and `/sw.js` with JavaScript content type and no-cache. Generated `_headers` already configures the worker's cache policy. HTTPS/certificate/hosting configuration cannot be proven by local builds; localhost is treated as a secure context only for local testing.

Unit coverage checks theme normalization and no OS listener, exact tab order, reachable Profile sections and booking reuse, nested invoice routing, installation intent/dismissal/platform guidance, separate Firebase scope, and execution of the service worker to verify private fetch bypass, public-only cache, explicit activation and 503 offline behavior. Browser mocks and jsdom do not establish real-device installation.

Before production release, use real Android and iOS devices to verify install/launch, login, browser permissions, camera scanning, booking, messaging, photo upload, private invoice viewing, push/deep links, keyboard and safe areas. Test offline failure, reconnect, dismiss/install detection, and an update while a form is unsaved. No Play Store/App Store publication or real-device/provider success is claimed.

Implementation verification: frontend production build and ESLint passed. The focused frontend regression tests passed (37 tests across theme, navigation, Profile, redirects, PWA/offline worker, Firebase and social profile); the backend theme tests passed (3). Generated production manifest icon sizes and the versioned offline worker were inspected from `dist`. The coordinated release report covers the subsequent full application checks.

## Back navigation and member-list state

Owner member search, membership/plan/trainer filters and pagination now persist in tab session storage scoped to the authenticated session, user and gym. Search terms do not enter URLs or durable local storage. Returning from details restores the filters before the first list request, including the debounced search. Switching gyms uses a separate scope; logout/session replacement clears stored navigation state.

Breadcrumb ancestors remember authorized list query strings within that same scope, reject unrelated/off-site stored destinations, and use a safe parent for direct links. Profile section breadcrumbs show the section label and return to Profile Overview without remembering a section that would cause a Back loop. Unsaved forms block breadcrumb navigation and browser unload; cancelled navigation and failed saves retain protection. A successfully saved/closed form is removed from dirty-state detection, and intentional form reset clears it. Component navigation tests cover each of these behaviors, including actual member-list request restoration.
