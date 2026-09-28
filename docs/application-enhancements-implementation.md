# Application enhancement implementation record

This coordinated update follows the permanent-QR/mobile/session/PWA request.
The working tree already contains the preceding role-signup implementation;
those changes are retained. React/Vite, Express/Mongoose, the existing attendance,
membership, refresh, theme, upload and PWA services remain the integration points.

## Requirement map recorded before implementation

| Section | Affected implementation | Verification / data impact |
| --- | --- | --- |
| 1–2. Inspection and precedence | Existing source, this checklist; new requirements supersede Light default and all-role footer/sidebar registration shortcuts | Preserve preceding signup/onboarding changes |
| 3. Permanent gym QR | GymScanner, attendanceQrService, attendanceController and QR routes, owner scanner display | Persist payload, atomic creation and unique indexes, legacy printed-code compatibility; guarded migration/diagnostic |
| 4. Direct camera | AttendanceQrPage and scanner lifecycle | Visible-route auto acquisition, permission/failure states, callback deduplication and stream cleanup |
| 5–7. Compact headers/mobile layout | WorkspaceLayout, WorkspaceBreadcrumbs, shared page/style tokens | Existing safe-back/list state, inline heading controls, touch targets and responsive checks |
| 8–9. Price/filter layout | LivePublic discovery, LiveData ResourcePage, members and other filter screens | Bounded min/max inputs, invalid ranges, responsive filter controls and preserved query state |
| 10. Promotional CTA | PromotionPlacement | Correct gym href, long names, carousel behavior |
| 11–12. Footer/sidebar | PublicLayout, WorkspaceLayout, InfoPage and hosting route configuration | Audit actual destinations/content, all-role registration removal, direct paths and genuine Not Found |
| 13. Owner onboarding | RegisterGymPage | Remove page-level Back without altering native history or creation idempotency |
| 14. Routine illustration | LiveLanding and shared animation CSS | Original SVG/CSS, existing message/CTA, reduced motion and offscreen pause |
| 15. Subscribed classes | Backend memberFeatureController/userRoutes/membership policy; frontend UserClassesPage and caches | Authoritative user/gym/date/freeze scopes for list/count/detail/booking, history remains accessible |
| 16. Profile editing | ProfileEditor, existing media editor and ProfileContactEditor | Grouped fields, dirty/save/cancel/errors, S3 pipeline and verified contact updates retained |
| 17. Notifications | NotificationsApiPage and notification styles | Responsive labelled actions, confirmation, current-user mutation/error/count behavior |
| 18. Session reliability | apiClient/session, auth controller/token/session services | Reproduce races/failures first, coordinated refresh, no logout for ordinary resource/network failures, secure revocation and bounded retries |
| 19. Phone fields | Shared PhoneInput/normalization; signup/contact/member/trainer/gym/admin/EditForm; backend phone schemas | Exact Indian local length, paste/autofill/API parity, optional blanks and legitimate international contacts; only account identities unique |
| 20. User dashboard | LiveWorkspace dashboard composition | Remove only USER finance details/graph, retain profile payment history and owner/admin analytics |
| 21. Dark initial theme | theme.ts, theme-init.js, User preference defaults and tests | Dark missing/invalid/System fallback, preserve explicit Light, no OS-following mode |
| 22–23. Install banner/PWA | pwa.ts, AppInstallBanner, PwaSettings, header integration, manifest/service workers | SessionStorage 120-second window, real user-triggered install event/guidance, no private runtime caching, Firebase worker coordination |
| 24. Bottom navigation | WorkspaceLayout | Home → Book → Scan → Profile → Messages retained |
| 25. Security/regressions | Existing permissions, membership, attendance, auth, media and integration suites | No tenant access based on client claims; no production destructive migration |
| 26–27. Acceptance/delivery | Actual builds/lint/Vitest/API scripts, browser width matrix, audit and secret scan | Report executed outcomes separately from mocks, emulation and unavailable physical-device checks |

## Initial findings

- Gym QR rendering currently reconstructs a signed payload using a deployment
  secret and permits revision rotation. The existing scanner identity and unique
  gym identity index can support persistence without a second QR system.
- Authenticated class listing currently starts from all visible gyms instead of
  the account's eligible memberships; booking already has transactional checks.
- The PWA manifest, offline worker, Firebase worker and profile installation
  controls already exist. Installation dismissal currently lasts 30 days in
  localStorage; the new banner needs a separate session-wide 120-second window.
- Phone constraints differ between signup, gym forms, contact verification and
  generic administrative editors. The existing identity normalization policy is
  reused and extended rather than adding a competing policy.
- Standalone breadcrumbs and nested layout margins add heading space; mobile
  filters/actions use desktop-sized rows. Theme initialization currently falls
  back to Light and needs the requested Dark fallback.

## Validation and release record

Implementation and validation are in progress. Results will be recorded here
with exact commands and limitations. No production deployment, data repair or
physical-device installation has been performed by this update.

The previous identity diagnostic reported two unrecognized legacy phones and
one identity mismatch. This update must not invent replacement contacts or
silently merge those accounts; their verified recovery remains a separate
release requirement described in account-identities.md.

Installation references reviewed: [MDN install prompt lifecycle](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt),
[appinstalled](https://developer.mozilla.org/en-US/docs/Web/API/Window/appinstalled_event),
and [web app manifest](https://web.dev/learn/pwa/web-app-manifest).
