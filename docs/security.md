# Security

- Passwords: bcrypt cost 12; password field excluded from normal queries.
- Sessions: short access tokens; refresh tokens are hashed in MongoDB, rotated and revocable per device.
- RBAC: backend role/permission middleware plus gym-scope checks on every tenant record.
- OTP/reset: hashed one-time values, expiry, attempt counters and rate limits; OTPs are never logged.
- Webhooks: raw body HMAC/signature validation, amount/currency verification and inbox dedupe.
- HTTP: Helmet, explicit credentialed CORS allowlist, body limits, request IDs, safe errors and HTTPS-ready cookies.
- Inputs: Zod validation, ObjectId checks, enum allowlists, escaped search expressions and no client-provided query operators.
- Uploads: allowlisted MIME/extensions, size limits, private originals, randomized keys and ownership checks.
- Privacy: masked bank data; minimum personal data; configurable retention; audit access is admin-only.
- Abuse: separate strict limits for login/OTP/reset/payment/QR and global rate limiting.
- Logging: secrets, tokens, OTPs, payment credentials and sensitive documents are redacted.

