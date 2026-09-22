# Testing Strategy

## Test layers

- Unit: token/OTP cryptography, quote calculation, geofence distance, QR validation, permissions and provider signatures.
- API integration: authentication, gym scope, CRUD validation, pagination, payment webhook, subscriptions, scanner, messages and notifications using Supertest.
- Frontend: form validation, route guards, loading/empty/error states and core hooks.
- E2E: Playwright flows for login/role routing, gym purchase success/failure, owner onboarding/admin approval, QR attendance, messaging read receipt and notification deep-link.
- Contract: OpenAPI schema validation for representative success and typed error responses.

Tests use isolated databases and provider test doubles only at integration boundaries. A feature is marked `TESTED` only when its frontend-to-database flow passes. Real provider certification remains credential-dependent and is documented separately.

