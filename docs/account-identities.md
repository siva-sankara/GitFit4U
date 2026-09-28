# Account identity and signup rollout

`POST /api/v1/auth/register` requires exactly `name`, `email`, `phone`, `password`, and an intentional `role` of `USER` or `GYM_OWNER`. Extra fields, privileged roles and missing contact details are rejected. Passwords are never trimmed. The existing password signup activation behavior is retained; invitation activation and verified contact changes retain their existing verification steps.

Email identity is trimmed and lowercased across signup, password sign-in, member invitations and verified profile changes. Dots and plus-address tags remain significant. Phone identity is stored in international `+<country><number>` form. Public signup accepts a ten-digit Indian local number or its explicit `+91` equivalent with recognized separators; arbitrary text, decimals, exponent notation and oversized numbers are rejected, never truncated. Existing explicit international numbers and recognized national trunk-prefix aliases remain supported in recovery/invitation paths.

The `users` collection has separate unique sparse `email_1` and `phone_1` indexes. Missing legacy contacts are allowed; empty or null contacts are removed by the migration, without inventing replacements. A canonical phone or email may belong to only one account across all roles and gyms. `authidentities` also retains its unique `(provider, providerSubject)` index. Transactions roll back failed signups; duplicate-key races return safe sign-in/recovery guidance. Unknown OTP/Google sign-in attempts require completion of public signup instead of creating incomplete accounts. Existing sign-in identities continue to work.

Owner-created memberships link to the established identity through the existing activation/acceptance flow. A gym cannot change the account password, roles or verified profile based on a matching contact. Conflicting contacts are rejected, without merging accounts. Member contact records are gym-local data; editing them does not change account identity. Profile contact edits still require OTP or verified Google identity and reject collisions excluding the current user.

Run the read-only diagnostic from `backend`, with `MONGO_URI` pointing at the intended database:

```powershell
npx tsx src/scripts/migrate-account-identities.ts
```

This uses raw collections without model index creation, and prints record IDs/counts and index metadata rather than contact values or credentials. It inspects canonical email/phone conflicts, malformed or missing legacy contacts, PASSWORD/PHONE identity ownership, account roles/statuses and gym/registration statuses. Exit code 1 means rollout is blocked. Verify the listed records through account recovery/support; do not delete users, invent phone numbers or automatically merge accounts. Keep the report private because it contains internal record IDs.

Before applying: take a database backup, resolve every reported conflict/invalid record, stop all account writes across every API/worker deployment, and rerun the diagnostic. Only then run:

```powershell
npx tsx src/scripts/migrate-account-identities.ts --apply --maintenance-confirmed
```

Apply normalizes recognized contacts and linked PASSWORD/PHONE subjects in a transaction, normalizes invitation email casing, installs/verifies the separate unique indexes and preserves all roles, memberships and gym relationships. Do not reopen writes if it exits unsuccessfully. No live migration is automatic on startup or deployment. Existing production indexes must be verified before accepting traffic; a successful local build is not evidence that migration ran.

Owner onboarding is derived from persisted owned gyms and registration records rather than resetting existing accounts to a new stored flag. Existing owners therefore retain their current active/pending/draft stage without a destructive role or onboarding backfill.

Registrations whose gym is missing or deleted are unavailable and require support. Replays and draft resumes reject them rather than creating replacement gyms or merging records. An inactive legacy gym without a registration also uses the suspended/support destination; support must verify its ownership and history before repair. Existing active gyms without legacy registration records continue to open their owner workspace. These read-time states do not alter stored gym status or charge/refund any payment.
