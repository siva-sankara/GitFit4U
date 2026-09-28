# Role signup, identity and theme implementation

## Repository findings and implementation map

The application uses React 19, React Router, React Query and Vite; Express 5,
Mongoose and MongoDB transactions implement the API. Canonical roles are `USER`,
`GYM_OWNER`, `GYM_STAFF`, `TRAINER` and `ADMIN`. Existing password signup creates
an active account; invited accounts have a separate activation flow. Gym
registration currently activates through verified payment, not manual approval.
Those existing rules remain the source of truth.

| Requirements | Existing integration points | Planned validation |
| --- | --- | --- |
| 1: inspect/map | Existing auth, routes, models, registrations, theme and scripts | This map before implementation |
| 2: public roles/security | `authRoutes`, `authController`, signup form/schema | Required role, strict fields, forged roles rejected |
| 3–5: owner onboarding and stored-role routing | Auth session/me, owner onboarding service, registration endpoints, shared `authRedirect`, route guards | New/incomplete/active owner, USER forbidden, restoration, safe deep links |
| 6–7: account identity/linking | User indexes, auth, OTP, profile contacts, invitations and member services | Independent canonical collisions, duplicate writes, linking preserves credentials |
| 8–9: phone/errors/retries | Signup schema, controlled local phone input, API validators, idempotent registration | Typing/paste/autofill, field errors, concurrent/repeated submits |
| 10: existing data | Read-only identity diagnostic and explicit migration; onboarding derived from persisted gyms/registrations | Conflict report before changes; no merges/deletions/invented contacts |
| 11–12: compact auth and active navigation | Existing auth page, route links, shared auth styles | Desktop/mobile, keyboard, direct/reload navigation |
| 13–14: theme and toggle | Existing AppContext, theme tokens, ThemePicker and profile settings | Contrast, toggle/persistence, mobile visibility, dark-mode regressions |
| 15–16: regressions/security | Existing permission, session, payment, account activation, contact and application tests | Existing suites plus isolated API database checks; external provider checks reported separately |
| 17–18: verification/delivery | Vitest, TypeScript builds, ESLint, isolated integration scripts, audit and secret scan | Actual results and remaining deployment actions recorded below |

## Shared authentication contract

Public signup submits `{name,email,phone,password,role}` with an intentional
`USER` or `GYM_OWNER` selection. Signup, login and `/auth/me` expose authoritative
`user.onboarding` for owner accounts: `state`, optional `registrationId`, `gymId`
and `currentStep`. States are `NOT_STARTED`, `DRAFT`, `PENDING`, `ACTIVE`,
`CHANGES_REQUESTED` and `SUSPENDED`. No client-provided onboarding state grants
permissions. An owner with no selected gym can authenticate for onboarding but
has no gym permissions. Existing role assignments remain required for gym access.

Existing gym and registration data determine onboarding on every session load;
this avoids a new stale state column or relabeling established owners. Current
legacy review-state compatibility and verified-payment activation are preserved.

## Implemented behavior

- Member signup persists `USER` and opens the existing member destination. Both
  navigation and backend authorization prevent ordinary members creating gyms.
- Owner signup persists `GYM_OWNER` and opens `/register-gym`. Without a gym,
  this session has no tenant permissions. Draft and pending-payment stages
  resume from saved data. Verified payment activates the existing gym, followed
  by a session refresh before entering its workspace.
  Onboarding owners retain account-level support, help, contact, profile,
  messages and notifications. An explicit route allowlist keeps those pages
  accessible without opening gym operations; unavailable registrations link
  to the existing contact page. New owner signup still opens registration directly.
- Login requires no role selection. Password, existing OTP and Google identities
  use shared account-based routing. Unknown OTP/Google identities are directed
  to explicit signup rather than creating accounts without required contacts.
  Existing invitation activation and verified contact-change flows remain.
- Email identity is trimmed/lowercased, retaining dots and plus tags. Passwords
  are never trimmed. Public signup stores `+91` plus exactly ten local digits;
  valid explicit international contacts remain supported in existing accounts.
  The signup field parses recognized paste without truncating oversized values.
- Separate sparse unique email and phone indexes enforce independent identity
  uniqueness. Duplicate database writes return safe sign-in/recovery guidance.
  Linking does not overwrite another account's credentials, profile or roles.
- Gym creation serializes through an owner write in a transaction and reuses an
  incomplete registration. Existing `IdempotencyRecord` storage retains creation
  results for 30 days, including replay after activation. Its existing unique
  `{scope,key}` index is reused; client retries reuse the same payload key.
  Replay/resume also rechecks ownership and gym availability. Missing, deleted,
  suspended and archived gyms show support guidance instead of active-workspace
  or payment actions; they cannot silently create replacement registrations.
- Shared light-mode surfaces, text, controls and focus tokens improve visual
  separation. Dark mode remains supported. The existing theme store drives one
  accessible 44-pixel moon/sun button; mobile navigation hides it while profile
  settings retain access. User bottom navigation remains Home, Book, Scan,
  Profile, Messages.

## Existing data and rollout

Read-only diagnostic, from `backend`:

```powershell
node --import tsx src/scripts/migrate-account-identities.ts
```

The September 28, 2026 inspection found 9 accounts, no missing email/phone values,
no canonical duplicate groups, and existing independent unique sparse `email_1`
and `phone_1` indexes. It flagged two unrecognized legacy phone values and one
authentication subject that does not match a recognized account contact. The
record IDs are retained in the local `.identity-review/account-identity-diagnostic.json`
artifact beside this repository, rather than in tracked documentation.

The diagnostic exited 1 deliberately with `safeToApply: false`. No users, roles,
credentials, gyms or indexes were changed. Contact values are omitted from this
report. Resolve these records through verified recovery/support; do not invent
numbers or merge accounts to make the check pass.

After resolution, rerun the diagnostic. The explicit migration command is:

```powershell
node --import tsx src/scripts/migrate-account-identities.ts --apply --maintenance-confirmed
```

The flag confirms stopped account writes and a backup. Migration blocks on
unresolved conflicts and verifies both unique indexes before traffic resumes.
It does not change roles or assign ownership. Onboarding derives from existing
gyms and registrations, so active owners need no destructive state backfill.
The inspected data had three active gyms and three active registrations.

## Verification results

| Check | Command / method | Result |
| --- | --- | --- |
| Backend unit/API component regression | `npm.cmd test -- --maxWorkers=2 --reporter=verbose` with dotenv disabled | 77 files, 536 tests passed |
| Frontend unit/component regression | `npm.cmd test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000` | 59 files, 348 tests passed |
| Frontend lint | `npm.cmd run lint` | Passed; final 8 changed routing/form files also passed targeted ESLint |
| Frontend production build/type check | `npm.cmd run build` | Passed after the final registration-availability and account-route fixes; TypeScript and Vite completed, 2,930 modules transformed |
| Backend lint | `npm.cmd run lint` | Passed |
| Backend build/type check | `npm.cmd run build` | Passed |
| Vercel entrypoint semantic type check | `npm.cmd run test:vercel-types` | Passed with Vercel-style temporary compiler configuration |
| Real MongoDB/API integration | `npm.cmd run test:integration` | 123 checks passed; disposable database removed |
| Registration/payment lifecycle | `npm.cmd run test:registration` | 128 checks passed; 2 simulated provider orders; disposable database removed |
| Invitation/activation/invoice lifecycle | `npm.cmd run test:enhancements -- --section account` | 5 scenario groups passed; disposable database removed; real transports disabled |
| Final owner login/role-switch guards | Focused `authController.test.ts` run after full suite | 29 tests passed, including new missing/revoked assignment checks |
| Final backend registration availability | Focused `registrationController.orphans.test.ts`, `registrationService.orphans.test.ts`, `ownerOnboardingService.test.ts` | 24 tests passed; final affected-file lint and backend build passed |
| Final frontend registration availability | Focused `RegisterGymPage.test.tsx` | 22 tests passed, including suspended/deleted/missing gym cases added after the full suite |
| Final onboarding account-route access | `npm.cmd test -- src/services/authRedirect.deepLinks.test.ts src/routes/AccessRouting.test.tsx src/routes/GuestRoute.test.tsx src/pages/public/AuthDesktopPage.test.tsx src/pages/public/RegisterGymPage.test.tsx --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000` | 5 files, 139 tests passed; account aliases avoid loops, operational/cross-role routes stay restricted and owner signup still opens registration |
| Production-preview browser smoke | Isolated Chrome against the built application; API responses intercepted before navigation | All assertions passed; 35 API requests mocked, external traffic blocked |
| Dependency audit, backend | `npm.cmd audit --json` | 0 known advisories reported, including High/Critical |
| Dependency audit, frontend | `npm.cmd audit --json` | 0 known advisories reported, including High/Critical |
| Identity diagnostic | `node --import tsx src/scripts/migrate-account-identities.ts` | Deliberately blocked by three legacy findings above; read-only |
| Working-tree credential-pattern scan | Tracked/nonignored text; private-key, provider-token, AWS-key and credential-bearing database-URL patterns | 521 files checked after all code changes; one documentation `YOUR_KEY` placeholder reviewed; no actual credentials identified |
| Whitespace/conflict-marker diff check | `git -c core.safecrlf=false diff --check` | Passed |

The initial unrestricted backend test pool was interrupted after resource
contention and a stale middleware mock failure; that mock was corrected before
the passing complete rerun. An initial frontend full run experienced a timeout
cascade; its isolated registration-page suite passed 19/19 unchanged, and the
passing full rerun used explicit 15-second test/hook timeouts. Full-suite totals
above precede the final small guard additions, which were checked in the focused
runs shown separately; overlapping test counts are not added together.

Browser checks covered route highlighting through Back/Forward/reload, intentional
keyboard role selection, phone typing/paste validation, error focus, 320-pixel
layout, 200% text resizing, theme navigation/reload persistence, and authenticated
mobile Settings/Profile. The navbar toggle is hidden on mobile while Settings
retains it. The final login card measures 699 pixels high with 44–48 pixel controls.
Computed Light contrast ratios were 18.10:1 for input text, 7.58:1 for secondary
text, 7.61:1 for selected auth text, 3.85:1 for the input boundary and 18.94:1 for
the profile native select/options. Screenshots, measured results and the browser
harness are in the local `.theme-review` directory beside this repository.
The browser pass preceded the final account-route allowlist/support-link change;
the focused route/form tests above cover that last change. The browser harness
does not represent an unmocked frontend-to-backend end-to-end run.

Unit/component tests mock persistence/providers where appropriate. The two API
scripts use actual isolated MongoDB transactions and indexes, with simulated
payment responses and disabled real notification/storage credentials. No real
charges, production writes, live email/SMS/WhatsApp/push sends or real S3 uploads
are implied by these results. Pattern scanning excludes ignored environment
files, dependencies and Git history; neither that scan nor dependency audits
establish absence of all application vulnerabilities.

## Existing-function regression coverage

| Area | Passing coverage and limits |
| --- | --- |
| Role login, recovery and activation | Backend auth/recovery/permissions and frontend routing/activation suites; actual isolated invitation acceptance, replay, expiry and account-linking scenarios |
| Memberships, gym relationships and reactivation | Membership lifecycle/access and frontend membership suites; general isolated API integration; linking retained existing credentials and relationships |
| Gym registration and platform subscription | Actual isolated transaction/idempotency/payment lifecycle; owner onboarding, platform renewal and registration UI suites; provider responses simulated |
| Payments and invoices | Checkout/refund/invoice/delivery suites and isolated account/invoice lifecycle; immutable snapshots and delivery deduplication checked; real email delivery and provider webhooks remain release checks |
| Classes and attendance | Class management/member booking, QR and manual attendance suites plus general API integration |
| Messaging, contact actions and notifications | Messaging/concurrency, contact formatting, notification links/delivery and Firebase adapter tests; no live WhatsApp/SMS/push delivery attempted |
| Profiles and uploads | Profile/contact-collision and frontend editor tests; S3/media/upload adapters tested with mocks; no live S3 upload attempted |
| PWA restoration and deep links | Session guards, shared auth destinations, PWA/offline helpers and safe deep-link tests; installed Android/iOS acceptance remains external |
| Appearance and role layouts | Shared Light/Dark token tests, guest auth and authenticated User Settings/Profile browser checks; separate Admin/Trainer/Owner browser tours were not performed |

## Important changed files

- Frontend forms/routing: `frontend/src/pages/public/AuthDesktopPage.tsx`,
  `GymRegistrationForm.tsx`, `RegisterGymPage.tsx`, `ActivateAccountPage.tsx`,
  `frontend/src/services/authValidation.ts`, `authRedirect.ts`, `session.ts`,
  route guards and public/workspace navigation.
- Backend identities: `backend/src/routes/authSchemas.ts`, `authRoutes.ts`,
  `backend/src/controllers/authController.ts`, `profileContactController.ts`,
  `memberManagementController.ts`, `backend/src/models/User.ts`,
  `backend/src/utils/accountIdentity.ts` and `backend/src/services/otpService.ts`.
- Owner access/retries: `backend/src/middleware/auth.ts`,
  `backend/src/services/ownerOnboardingService.ts`,
  `backend/src/controllers/registrationController.ts`, owner/workspace routes.
- Migration: `backend/src/scripts/migrate-account-identities.ts`,
  `backend/src/services/accountIdentityMigration.ts`; policy in
  [account-identities.md](account-identities.md).
- Theme: `frontend/src/components/ThemePicker.tsx` and shared tokens/global,
  layout, dialog, notification and page styles. Existing theme context remains
  the single preference store.

## Requirement status and remaining release checks

| Prompt section | Implementation status |
| --- | --- |
| 1. Inspect/map | Complete; repository findings and file/API/test map above preceded edits |
| 2. Role signup | Implemented; intentional accessible USER/GYM_OWNER choice and strict server allowlist |
| 3. Direct owner onboarding | Implemented; persisted draft/payment/active state, restricted initial session, transactional retries |
| 4. No USER gym registration | Implemented in navigation, protected routes and API; legitimate stored multi-role capabilities preserved |
| 5. Stored-role login | Implemented through shared frontend routing and authoritative backend onboarding; existing Admin/Trainer destinations retained |
| 6. Independent identities | Implemented and actual MongoDB concurrent email/phone signup checks passed |
| 7. Linking | Existing activation/acceptance retained; collision/credential preservation covered by unit and isolated lifecycle checks |
| 8. Ten-digit phone input | Implemented for typing, paste, autofill and direct signup API; existing valid international contacts retained |
| 9. Feedback/retries | Implemented; field errors, retained non-sensitive values, submission guard and database/idempotency protections |
| 10. Safe migration | Diagnostic and guarded migration implemented; existing-data apply blocked by three review findings, no live mutation performed |
| 11. Compact auth | Implemented; production-preview desktop/mobile/text-resizing checks passed |
| 12. Active auth mode | Implemented with route-aware navigation links/current-page state; direct, history and reload checks covered |
| 13. Light/Dark tokens | Implemented in shared components/styles; contrast tests and actual auth-page computed-color checks covered |
| 14. Icon toggle | Implemented using existing provider; light/dark only, persistence retained, mobile nav hidden/settings available |
| 15. Existing functions | Backend unit, general API, payment-registration and account/invoice lifecycle checks passed; live provider/device acceptance remains external |
| 16. Security | Strict signup fields, live permissions/ownership, retained hashing/session/CSRF and rate limits; no public account lookup added |
| 17. Required tests | Added auth, routing, identity, migration, phone, theme and retry tests; actual totals/limitations above |
| 18. Delivery | Coordinated source update and this report; full backend/frontend suites, API lifecycle checks, audits and browser smoke passed; production-data and external-service limitations recorded |

Before production promotion: resolve the diagnostic's three legacy findings and
verify the indexes on the intended production database. Coordinate both Vercel
projects because the new frontend depends on the backend's required role and
onboarding contract; keep public signup closed during mixed-version rollout.
No Vercel deployment/settings were changed by this implementation.

Perform a real provider test-mode payment/webhook, verified sender email,
SMS/WhatsApp/push, S3 upload and installed Android/iOS PWA acceptance using the
deployment's configured services. Mocked browser/API tests do not certify those
external deliveries, browser cookie policies or device behavior. Test the actual
production origins and session restoration after both projects are deployed.

Design references: [React controlled inputs](https://react.dev/reference/react-dom/components/input),
[MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/),
and [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
