# User Flows

## Authentication

Login or OAuth/OTP → backend validates identity and account state → access token plus revocable refresh session → server-authoritative role claim → Admin, Owner, Trainer or Member dashboard. Disabled/unverified users receive a typed error and recovery path.

## Member purchase

Explore nearby gyms → gym detail → select active plan → backend creates expiring immutable quote → Razorpay order → provider checkout → signed webhook verification → payment captured → subscription activated in a MongoDB transaction → invoice and notification → subscription detail.

Failure: payment remains failed/cancelled; retry creates or reuses a safe payment attempt and never activates from frontend success alone.

## Owner onboarding

Register owner → gym draft → details/location/hours → documents/uploads → platform plan → payment → verification pending → Admin reviews → approve/reject with reason → approved gym becomes active and publicly discoverable → dashboard unlocks.

## Attendance

Member requests short-lived signed QR → gym scanner reads token → backend validates signature, expiry, gym, active subscription, duplicate cooldown and optional geofence accuracy/radius → immutable attendance event → check-in success and streak projection. Invalid, expired, already checked-in and out-of-range responses are explicit.

## Trainer

Trainer dashboard → assigned client → workout plan → assign versioned plan → scheduled session → record attendance/progress → member receives notification. Trainer queries are restricted to assigned gym and clients.

## Messaging and campaigns

Authorized participant opens conversation → paginated history → sends idempotent client message → MongoDB persistence → Socket.IO delivery/read receipt → unread counters update. Owner broadcast: audience → message → preview → schedule/send → worker dispatches permitted channels → provider callbacks update analytics.

## Admin approval

Registration queue → view gym/documents/payment → verify checklist → approve/reject → audit entry → owner notification → only approved and paid gyms are public.

