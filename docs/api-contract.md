# API Contract

All endpoints use `/api/v1`. Authenticated requests use `Authorization: Bearer <access-token>`; refresh uses an HttpOnly cookie. Lists accept bounded `page`, `limit`, `sort`, `q`, status and date filters.

## Identity

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Start member/owner signup and submit WhatsApp OTP |
| POST | `/auth/signup/verify` | Public | Verify signup OTP, create account and issue the normal session |
| POST | `/auth/signup/resend`, `/auth/signup/cancel` | Public | Replace or cancel pending signup verification |
| POST | `/auth/login` | Public | Email/phone and password login |
| POST | `/auth/google` | Public | Verify Google ID token |
| POST | `/auth/otp/request`, `/auth/otp/verify` | Public | Rate-limited WhatsApp OTP login |
| POST | `/auth/forgot-password`, `/auth/reset-password` | Public | Recovery lifecycle |
| POST | `/auth/refresh`, `/auth/logout`, `/auth/logout-all` | Session | Rotate/revoke sessions |
| GET/PATCH | `/users/me` | Any | Profile and preferences |
| GET/DELETE | `/users/me/sessions/:id?` | Any | Device sessions |

## Discovery/member

| Method | Path | Purpose |
|---|---|---|
| GET | `/public/gyms`, `/public/gyms/:slug` | Geo/filter discovery and public detail |
| GET/POST/DELETE | `/users/favorites[/:gymId]` | Favorite gyms |
| GET/POST/PATCH | `/users/reviews[/:id]` | Review lifecycle |
| GET/POST/DELETE | `/users/classes`, `/users/classes/:id/bookings` | Browse/book/cancel class |
| GET | `/users/subscriptions`, `/users/subscriptions/:id` | Memberships |
| POST | `/users/subscriptions/:id/{renew|freeze|cancel|change-plan}` | Lifecycle commands |
| GET | `/users/attendance`, `/users/attendance/stats` | Attendance history/projections |
| POST | `/users/attendance/qr` | Issue signed short-lived QR |
| GET/POST | `/users/referrals` | Referral dashboard/invite |

## Commerce

| Method | Path | Purpose |
|---|---|---|
| POST | `/checkout/quotes` | Price/discount/tax quote |
| POST | `/checkout/orders` | Create provider order |
| POST | `/checkout/verify` | Verify checkout signature; webhook remains authoritative |
| GET | `/checkout/payments/:id` | Payment status |
| POST | `/admin/payments/:id/refunds` | Idempotent refund |
| POST | `/webhooks/razorpay` | Signed provider events |

## Owner

`/owner/registrations`, `/owner/dashboard`, `/owner/gym`, `/owner/members`, `/owner/plans`, `/owner/subscriptions`, `/owner/scanner/check-in`, `/owner/attendance`, `/owner/classes`, `/owner/trainers`, `/owner/offers`, `/owner/ads`, `/owner/campaigns`, `/owner/revenue`, `/owner/reports` provide CRUD and lifecycle commands with gym scope and permissions.

## Trainer

`GET /trainer/dashboard|clients|sessions|schedule|workout-plans|progress|attendance`; `POST/PATCH /trainer/workout-plans`; `POST /trainer/clients/:id/workout-assignments`; `POST /trainer/sessions/:id/complete`; `POST /trainer/clients/:id/progress`.

## Messaging/notifications

`GET/POST /conversations`; `GET/POST /conversations/:id/messages`; `POST /conversations/:id/read`; `GET /notifications`; `PATCH /notifications/:id/read`; `POST /notifications/read-all`; `POST/DELETE /devices`. Participant authorization is mandatory.

## Admin

`GET /admin/dashboard|gyms|owners|users|payments|revenue|refunds|monitoring|audit`; gym approval commands; account status/role commands; platform plan CRUD; review moderation; campaign/ad/support management.

## Responses

Success: `{ "success": true, "message": "...", "data": {}, "meta": {} }`.

Error: `{ "success": false, "message": "...", "errors": [{"path":"field","code":"..."}], "requestId": "..." }`.

The development server exposes the full OpenAPI document at `/api-docs` and JSON at `/api-docs.json`.

