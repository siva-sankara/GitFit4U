# Fix the configured AWS upload access

The live diagnostic on 2026-09-09 confirmed two separate AWS errors:

- PUT: AccessDenied because no identity-based policy allows s3:PutObject.
- Browser preflight: AccessForbidden because CORS is not enabled on the bucket.

The key was recognized by AWS. The configured endpoint matches the region. These are AWS access settings; changing environment variables or restarting the app alone cannot fix them. No credentials are included in these files.

## 1. IAM object permissions

Sign in to AWS with an administrator identity. In IAM, find the user or role whose access key is configured as OBJECT_STORAGE_ACCESS_KEY. Add the JSON from [iam-policy.json](iam-policy.json) as an inline policy named GetFit4UMediaObjects (or merge its statement into the identity's existing application policy). This is an IAM identity policy, not a bucket policy. It grants Put/Get/Delete only on application object paths and diagnostic files in the configured bucket. It does not grant public access or AWS administrative permissions.

## 2. Bucket CORS

In S3, open bucket **getfit4u-media**, region **ap-south-2**. Open Permissions ? Cross-origin resource sharing (CORS) ? Edit. Paste [cors.json](cors.json) and save. The origins are taken from CLIENT_ORIGIN; keep them synchronized if the frontend URL changes. Keep Block Public Access enabled. CORS allows browser requests but does not replace IAM permission checks.

For an administrator using AWS CLI, [cors-cli.json](cors-cli.json) contains the CORSRules wrapper required by s3api put-bucket-cors.

## 3. Verify

From backend run npm run test:storage. It writes, reads and removes its own temporary diagnostic object and checks browser preflight. Once both checks pass, choose Upload and add to profile again; the selected file can be retried. No app restart is needed for an IAM/CORS-only change.

These configuration files have been prepared locally but have not been applied to AWS. Applying IAM policies requires IAM administration permission; updating CORS requires s3:PutBucketCORS. The application upload key should not be granted those administrative permissions.

References: [AWS CORS troubleshooting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors-troubleshooting.html), [presigned URL permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
