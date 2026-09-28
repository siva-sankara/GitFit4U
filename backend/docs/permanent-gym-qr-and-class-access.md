# Permanent gym QR and member class access

`GET /api/v1/owner/attendance/qr` returns the saved `GymScanner.qrPayload`. New identities use `getfit4u:gym:<random 24-character reference>`. Unique indexes enforce one `GYM_IDENTITY` per gym, unique public references and unique saved payloads. Concurrent first reads use atomic upsert and return the committed identity. Gym edits, downloads, page loads, new sessions, membership renewals and deployment signing-secret changes do not rotate saved bytes. `POST /api/v1/owner/attendance/qr/rotate` returns `410 QR_PERMANENT`.

Existing v2 printed codes resolve the stored public reference, gym and current revision. They remain usable after a signing-secret change because the QR identifies a gym; it does not authenticate a member. Earlier deliberately revoked revisions and disabled identities remain invalid. The old signature is therefore not relied on as authorization. Current-revision legacy payloads are saved byte-for-byte when reconstructable with the original signing secret. If that secret already changed before the first persistence, the original print bytes cannot be reconstructed; existing printed codes still resolve the same stored tuple. No identity is merged or replaced automatically.

Member check-in still requires an authenticated account, its own active/non-pending gym relationship, an active current membership (or existing explicit direct-access eligibility), an active non-deleted gym, and configured location validation. A printed QR is public and does not prove physical presence. Location validation, when enabled, remains an additional check. Daily attendance uniqueness and idempotency remain enforced by database indexes.

Run the read-only diagnostic from `backend`:

```powershell
npx.cmd tsx src/scripts/migrate-gym-qr-identities.ts
```

It does not import models, auto-create indexes, change records, print secrets or print QR contents. The September 28 diagnostic found 5 gyms, 3 legacy identities, 0 saved payloads, 2 gyms without identities, no conflicts or invalid identities, and all three required unique indexes. No production backfill was performed. Before a managed migration, review the report, back up the database, stop identity writes and run:

```powershell
npx.cmd tsx src/scripts/migrate-gym-qr-identities.ts --apply --maintenance-confirmed
```

Apply is idempotent, establishes uniqueness before writing, preserves stored payload/status/revision values, fills missing legacy payloads and initializes only non-deleted gyms without an identity. Conflicts or orphan identities block the migration; it never merges them or drops incompatible indexes. The application also lazily fills a missing payload using the same conditional write.

`GET /api/v1/users/classes` and `GET /api/v1/users/classes/:id` share server-owned eligibility. The authenticated user's active, non-pending member relationship must match an active subscription, its current cycle (where recorded), its gym, and its current effective dates. Gyms must be active, non-deleted, verified and platform-active. The entire upcoming class must fit the subscription period. A supplied gym filter only narrows this scope. `q` performs literal case-insensitive name search; day, pagination and counts use the same scope. `meta.eligibleGymCount` ignores date/search filters so clients can distinguish no eligible memberships from no matching classes. Database errors propagate rather than falling back to all gyms. Booking rechecks membership within its existing transaction and rolls back seat increments on denial. Existing owned booking history and public gym marketing previews retain their separate behavior.

New contact entry uses `contactPhone` / `optionalContactPhone`: exactly ten Indian local digits become `+91...`; explicit legitimate international numbers retain their country code; recognized spaces, hyphens and parentheses are formatting only; arbitrary letters, scientific notation and extra local digits are rejected. Optional blanks remain optional. Account login/recovery keeps its existing legacy alias support. Emergency/gym contacts gain no unique account-identity indexes.

Verification:

```powershell
npm.cmd run test:enhancements -- --section attendance-classes
```

This command owns a newly generated `gfv_...` database, verifies its ownership marker before cleanup, uses dummy `.invalid` media signing configuration, blocks external fetches, and never uploads or sends provider messages. It checks actual database concurrency, QR stability and legacy compatibility, member/class scope and history, plus existing booking/notification/class-media fixture regressions. Physical camera permission, scanning and print-device behavior require device/browser validation separately.

Validated on September 28, 2026: backend compilation and targeted lint passed; 9 focused test files covered 72 distinct tests across the focused runs; the isolated attendance/class suite passed all 10 scenario groups. The final existing API integration suite passed 123 checks and the registration suite passed 128 checks with 2 simulated gateway orders and no real charges. Every owned test database was removed, including the first attendance/class run that exposed missing dummy media URL-signing configuration; that fixture configuration was corrected before the successful rerun. No production migration was applied.
