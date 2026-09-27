# Media configuration and gym logos

The previous implementation only read `OBJECT_STORAGE_*` values and generated S3 PUT links. Cloudinary variables were not read at all, so setting Cloudinary credentials could not make that upload path work.

The existing `/api/v1/uploads` API now supports either provider. Configure server-only variables:

```dotenv
MEDIA_STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_FOLDER=getfit4u
```

Keep these values out of frontend `.env` files. Signed Cloudinary uploads do not need an unsigned upload preset. To keep S3, set `MEDIA_STORAGE_PROVIDER=s3` with the existing `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY`. If no provider is selected, configured S3 credentials keep precedence; otherwise a configured Cloudinary cloud is selected.

The browser initiates an upload with name, MIME type, size and purpose, sends binary bytes to the authenticated API URL returned by initiation, then completes it. The backend checks ownership, gym scope, extension, declared size and file signature before it contacts the provider. The API uses raw binary parsing for this route; it constructs signed multipart data for Cloudinary on the server. Proxy request-size and request-timeout limits must permit 50 MB and at least 120 seconds for gallery videos. Gym logos accept JPG/PNG/WebP up to 5 MB. Gallery images allow 10 MB; MP4 videos allow 50 MB.

Attachment records retain provider, object key, provider public ID, secure URL and image dimensions where returned. Gym records persist `logoAttachmentId`, and responses resolve the current logo URL. S3 read URLs are generated on read; expired links are not stored as logo fields. Replacing/removing a logo updates the gym reference and retains the old attachment for recovery; authenticated attachment deletion is refused while the file remains referenced by a gym.

Gym profile, gallery and avatar assets use public delivery. Message, document and progress uploads use Cloudinary's authenticated delivery type with signed five-minute download links, or the existing private S3 bucket with presigned reads. Access checks run before download links are returned. Keep the S3 bucket private.

Provider configuration errors, rejected credentials, invalid image bytes and request failures produce distinct safe user-facing errors. Server secrets and provider stack traces are never returned. Real S3 image upload, persistence, owner/public download, replacement, removal and cross-gym rejection passed the isolated verification, with both generated objects cleaned up. Repeat these checks after changing provider or deployment configuration; a live Cloudinary account was not tested in this session.

The legacy `npm run test:storage` command remains an S3-only diagnostic, including its historical bucket-CORS checks. It does not validate Cloudinary. Current browser uploads reach the authenticated application API, so browser-to-bucket PUT CORS is no longer required for new uploads. Do not treat that legacy CORS result as a requirement for the new upload path.

Provider API references: https://cloudinary.com/documentation/image_upload_api_reference and https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
