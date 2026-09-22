# AWS storage configuration (unrelated to gym activation)

Gym registration now requires verified payment only. It does not upload documents, require S3, or wait for document review. See [the current registration flow](gym-registration-flow.md).

Existing uploaded files are retained. Other application upload features continue to use private S3 objects, temporary signed URLs and backend metadata checks.

## Configuration for other uploads

```dotenv
OBJECT_STORAGE_ENDPOINT=https://s3.ap-south-1.amazonaws.com
OBJECT_STORAGE_REGION=ap-south-1
OBJECT_STORAGE_BUCKET=your-private-bucket
OBJECT_STORAGE_ACCESS_KEY=your-server-access-key
OBJECT_STORAGE_SECRET_KEY=your-server-secret-key
```

Use the regional S3 service endpoint; the signer adds the bucket to the path. Keep credentials on the backend, keep Block Public Access enabled, and grant the backend identity `s3:PutObject`, `s3:GetObject` (also used by HEAD), and `s3:DeleteObject` on the application's object prefix. Browser PUT uploads require bucket CORS for the exact frontend origins configured in `CLIENT_ORIGIN`, allowing `PUT`, `GET`, `HEAD` and the `Content-Type` header.

`npm run test:storage` from `backend` tests a uniquely named non-personal diagnostic object and attempts to remove it afterward. It checks upload, metadata, download and browser CORS. This test is independent of registration and does not change bucket configuration.

The last storage diagnostic returned HTTP 403 `AccessDenied`; browser preflight also returned 403. This remains relevant to other upload features, but does not block payment-only gym registration.

AWS references: [presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html) and [S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html).
