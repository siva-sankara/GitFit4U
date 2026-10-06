# Signup and login flow

## Signup

`/register` preserves the existing name, email, password and `USER`/`GYM_OWNER` role choice, and adds an international WhatsApp phone selector (India `+91` by default). `POST /api/v1/auth/register` now creates only a short-lived `PendingAuthOperation`; it does not create a user, activate an account, set a refresh cookie or return an access token.

The API normalizes the number to E.164 and submits a six-digit code through GETFIT4U's platform-owned Meta WhatsApp sender. The browser stores only the opaque operation/challenge IDs, masked display number and timers. `POST /api/v1/auth/signup/verify` atomically consumes the challenge and creates the user plus password and verified-phone identities in one MongoDB transaction. A duplicate email/phone at commit time rolls back the whole transaction. “Change number” cancels the pending operation; any replacement signup needs a new code.

## WhatsApp OTP login

`/auth/phone` and `/auth/otp` provide **Login with WhatsApp OTP** alongside password login. The backend verifies the challenge before using the existing access-token, refresh-cookie and role-destination flow. It never creates an account, merges identities or assigns roles during login. Active legacy accounts can establish their PHONE identity only by successfully proving possession with the new OTP. Disabled/blocked accounts cannot log in. Administrator accounts are deliberately excluded from WhatsApp OTP login so this method cannot bypass privileged authentication/MFA controls.

## Challenge security

- Six digits from `crypto.randomInt`; five-minute expiry; 60-second resend cooldown; five incorrect attempts.
- Persistent per-phone and HMAC-hashed per-IP abuse limits in MongoDB, in addition to route-level IP throttling.
- Only an HMAC verifier using `AUTH_OTP_HMAC_SECRET` is stored. Plaintext codes are never returned, logged or written to browser storage.
- Purpose (`SIGNUP`, `LOGIN`, `ACCOUNT_RECOVERY`, or `STEP_UP`), phone and pending signup operation are bound to the challenge.
- Verification uses an atomic conditional update. A successful code is single-use; concurrent/replayed claims fail. A resend consumes all earlier challenges without clearing the wider abuse history.
- Meta acceptance is recorded as `SUBMITTED`, not delivered. Signed webhook status events update the challenge to `SENT`, `DELIVERED`, `READ` or `FAILED`.

Password recovery and verified profile-phone changes use the same real WhatsApp transport and challenge controls. Existing password and Google login remain available when WhatsApp is unavailable.

## Verification

Run `npm run build`, `npm run lint` and `npm test` in both `frontend` and `backend`. Automated provider tests validate the Meta request shape with a mocked network; they do not prove delivery to a physical device. A real-device test requires the production/test recipient to receive the approved authentication template and the Meta webhook worker to record its delivery status. See [WhatsApp integration](WHATSAPP_INTEGRATION.md#platform-authentication-otp-setup).
