# Media configuration and gym logos

New uploads use **S3 only** through the existing authenticated `/api/v1/uploads` initiation, byte-upload and completion endpoints. Cloudinary configuration never selects a provider for new uploads. Existing completed Cloudinary attachments remain readable/deletable from their saved metadata; unfinished legacy uploads must be restarted.

See [Social profiles and S3 media](social-profile-and-s3.md) for server-only environment variable names, ownership checks, image decoding/metadata stripping, real thumbnails, private presigned downloads and retention behavior.

Keep the bucket private. The browser sends bytes to the application API, not directly to S3, so API-origin/CORS configuration is relevant; browser-to-bucket PUT CORS is not required by this flow. The legacy `test:storage` diagnostic includes historical bucket-CORS checks and must not be treated as the current upload acceptance test.

From backend, `npx tsx src/scripts/verify-isolated-membership.ts --run-isolated --verify-media` verifies real generated image upload, thumbnail, persistence, owner/public reads, replacement, removal and cross-tenant rejection using an isolated database. It removes only its own generated media and temporary database. Proxy limits must permit the existing allowed video sizes/timeouts; logos and avatars accept still JPG/PNG/WebP up to 5 MB.

The latest execution evidence and configuration blockers are recorded in [Enhancement verification](ENHANCEMENT_VERIFICATION.md).
