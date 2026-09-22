# Signup and login flow

- `/auth/signup` (also `/signup` and `/auth/register`) creates a member through `POST /api/v1/auth/register` using name, email, optional phone and password. Password confirmation stays in the browser. Successful registration saves the access token and opens the member workspace.
- `/auth/login` (also `/login`) submits email or phone and password to `POST /api/v1/auth/login`. The backend role determines the destination. Owner onboarding remains at `/register-gym`; public signup never grants privileged roles.
- `/auth/phone` requests a LOGIN challenge; `/auth/otp` verifies it. New verified numbers create member accounts, matching the existing backend behavior.
- `/auth/forgot-password` requests an ACCOUNT_RECOVERY challenge. Verification returns a short-lived reset token; `/auth/reset-password` changes the password and clears the local session. Accounts without a phone number are directed to support.
- Challenge state survives reloads in session storage. Missing challenges redirect to the phone form. Resend is available after 60 seconds; backend rate limits remain authoritative.

## Local verification

Run `npm run build` and `npm test` in both `frontend` and `backend`. Configure `VITE_API_URL` for the backend and run MongoDB for real account creation. Existing backend CORS/cookie configuration must match the frontend origin.

The OTP service includes MSG91 delivery using `MSG91_AUTH_KEY` and an approved `MSG91_TEMPLATE_ID`. Without those settings, development displays `devOtp`; production returns an unavailable error. Actual SMS delivery requires provider acceptance testing.

Frontend component tests mock API responses and backend controller tests mock persistence. They cover signup payloads, role redirects, phone identity lookup, duplicate accounts and OTP purpose separation; they do not replace a live database/SMS end-to-end test.
