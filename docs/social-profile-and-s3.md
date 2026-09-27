# Social profiles and S3 media

New uploads always use S3. `MEDIA_STORAGE_PROVIDER=cloudinary` no longer selects an upload provider. Existing completed Cloudinary attachments remain readable and deletable using their original provider metadata; existing unfinished Cloudinary uploads must be restarted. No legacy objects are deleted by an upgrade.

## Upload path and configuration

Authenticated initiate → authenticated API byte upload → extension/signature/size/tenant checks → full image decode → metadata-stripped image and 160px WebP thumbnail → private S3 objects → READY attachment → authorized profile/content reference.

Existing `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY` names retain precedence. Standard aliases are `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. Temporary credentials can also use `OBJECT_STORAGE_SESSION_TOKEN`. These are server-only variables. Standard AWS bucket configuration derives the regional S3 endpoint. Virtual-hosted and path-style S3 endpoints are supported. Reads expire after five minutes. No public ACL is applied, and private object links are never rewritten into unsigned CDN URLs.

The previously reported “Could not reach cloud storage” text was the browser uploader's generic network-error handler. Configuration inspection found the existing S3 fields populated, no Cloudinary cloud configured and no explicit Cloudinary selection. That text alone cannot prove a Cloudinary failure. The current internal-upload error distinguishes API connectivity/CORS from a safe server-side S3 rejection. Browser uploads use the API origin, so no S3 browser PUT-CORS policy is required for new uploads. API origin/CORS and connectivity must still be correct.

JPEG, PNG and WebP are the image formats. Profile/trainer/logo uploads are limited to 5 MB. Social images use the image policy (the UI limits them to 5 MB); existing PDF/video purposes remain supported. Images above 40 MP, 12,000px per side, malformed images or animated images are rejected. Generated object paths contain only server-selected identity/purpose/random IDs. Small avatars prefer actual thumbnails; existing original URLs remain a compatibility fallback when no thumbnail exists. Original image metadata is not retained.

Replacing/removing a profile photo changes its attachment reference; it does not destructively remove the original object. Explicit attachment deletion refuses files still referenced by active profiles, trainers, gym settings or social content. Expired story media is retained for controlled retention; cleanup does not make provider deletion calls.

## Social behavior

`/api/v1/social/profiles` searches paginated public profiles. `/profiles/:id` accepts a public ID or `me`. `/profiles/:id/follow` supports POST/DELETE. `/profiles/:id/followers`, `/following`, `/posts` and `/stories` are paginated GETs. `/social/posts` and `/stories` accept POST; `/:id` supports author PATCH and author/platform-admin DELETE. Media must be a READY S3 attachment owned by the author with the exact purpose. No arbitrary media URL is accepted.

Social visibility defaults to PRIVATE. Only the owner and authorized platform admin see private posts, stories, follower lists and streaks; private profiles reject new follows. Public profiles are visible to authenticated active accounts. Public serializers exclude email, phone, emergency contacts, birth date, height and weight. Following is unique per pair and self-follow is rejected. Posts are soft-deleted for audit.

Follower/following counts and pages both include only active counterpart accounts, with filtering before pagination. Suspended accounts retain their relationships for possible reactivation, but can still be unfollowed. Unfollowing a missing account is idempotent. Maintenance walks at most 100 relationship records per pass and removes only references to absent users, not suspended accounts.

Story expiry is computed on the server as creation + **25 hours**, with immediate read filtering even if a maintenance worker is delayed. Maintenance archives a bounded batch of expired rows. There is no browser-dependent expiry job.

The story strip is paginated, including access to stories beyond the first 20. An already-open viewer also expires at its server deadline even if refresh fails; deleting/expiring the last item on a page returns to the last available page.

Streaks qualify only from CHECK_IN attendance events. Dates are deduplicated across gyms in the member's saved IANA timezone. Yesterday preserves an active streak; missing a full local day resets current streak while preserving longest. Opening a profile never manufactures attendance. The existing StreakProjection model stores cached USER-scope aggregates alongside existing gym projections; grouped attendance dates are streamed instead of downloading all events.

## Profile contact verification

PATCH `/api/v1/users/me` accepts independently patchable non-sensitive fields and validated avatar attachment references; it rejects email, phone, roles and arbitrary avatar URLs. Phone changes use `/me/contact/phone/request` and `/confirm`: a rate-limited STEP_UP OTP is bound to the authenticated account and consumed once. Email changes use `/me/contact/email` with a Google ID token verified for the configured audience and verified email. User and authentication identity changes are transactional; other sessions are revoked. Email-change UI explains when Google verification is not configured. Real SMS delivery requires existing MSG91 configuration; development-only OTP behavior is unchanged.

Omitted fields stay unchanged. Explicit `null` clears birth date, gender, height, weight, emergency contact or avatar metadata; the strict schema does not accept arbitrary `$unset` operations, dot paths, whole-profile clearing or sensitive-field edits.

## Safe migration

Before enabling profiles against an existing database, run `npx tsx src/scripts/migrate-social-media.ts` from backend to inspect planned changes. Run again with `--apply` in an approved maintenance window. It replaces only the old global gym/member streak index with its backward-compatible partial version and creates unique follow/global-streak and content-query indexes. It preserves all records and provider objects, reports legacy Cloudinary record count without secret values, and does not enable automatic destructive `syncIndexes`.

The dry run reports duplicate groups and `safeToApply`; applying refuses those conflicts before changing any index. Discovery, active-story paging and latest-attendance query indexes are included. If the legacy index blocks a user's streak projection, the API returns `STREAK_INDEX_MIGRATION_REQUIRED` instead of silently displaying a zero streak. No migration runs automatically on a profile request.

Dependency added: `sharp` for validated image decoding/re-encoding and thumbnails. No AWS or Firebase secret belongs in frontend code or configuration.
