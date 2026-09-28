# Classes, images and booking delivery

Class create and edit keep the shared validated schema. Optional blank room/trainer inputs are normalized, capacity remains an integer, errors identify their fields, and dates are serialized with an explicit timezone offset. A trainer must belong to the same gym and remain active.

## API additions

- `POST /api/v1/uploads` accepts purpose `CLASS_IMAGE`: completed S3 JPG/PNG/WebP images up to 5 MB, using the existing validated server byte-upload flow.
- Class create/update accepts `imageAttachmentId: string | null`. Omission retains the existing image; null removes it. Binding requires a completed upload owned by the actor in the current gym. Existing legacy URLs remain readable.
- `GET /api/v1/users/classes/bookings/:bookingId` returns a booking only to its member account. The UI opens `/app/classes?booking=<id>` independently of discovery/history pagination and remains behind authentication.
- `PATCH /api/v1/owner/gym` accepts strict `classReminders: { enabled: boolean, leadMinutes: integer }`, 15–1440 minutes. Owners configure it in Gym Profile Settings. The existing gym audit records configuration changes.
- The same gym settings endpoint accepts `membershipReminders: { postExpiryDays: integer }`, 0–7 with a legacy default of 7. Zero stops follow-ups at the membership's expiry timestamp; the daily seven-calendar-day pre-expiry schedule remains. Shortening the window suppresses already queued stale pushes on delivery. These settings apply to member gym memberships; platform subscription reminders retain their separate policy.

## Behavior and compatibility

Legacy gyms default to reminders enabled, 60 minutes before class. Each booked member receives one durable reminder per booking time and scheduled start. Rescheduling starts a new cycle. Class cancellation, booking cancellation and rescheduling skip old queued reminders. Push delivery checks the latest class, member, booking, settings and cycle immediately before sending. An already dispatched provider request cannot be recalled.

Seat allocation, membership/access checks, booking writes and persistent notification outbox writes commit together. Membership/access records are write-locked so concurrent lifecycle updates cannot race the eligibility check. Firebase delivery and realtime notification publication occur after commit through the existing workers. Failed reservations roll back both seats and notification rows.

Chosen cleanup policy: new, unattached `CLASS_IMAGE` uploads are retained at least 24 hours. Detaching/replacing an image resets that grace period. Maintenance checks at most 20 candidates per tick, atomically locks the attachment against new bindings, protects every class reference including historical/cancelled classes, then calls the existing S3 deletion service after commit. Failed deletions remain retryable after five minutes. Keys must match the exact server-generated gym/class namespace. Legacy storage, other media purposes and in-progress uploads are excluded.

The existing `npm run db:migrate` index migration creates the additive class image/reminder indexes and attachment cleanup index; no class records or media are migrated or removed by that migration. No new environment variables are required. Existing S3/Firebase configuration remains server-side.

## Verification coverage

Unit/component tests cover image tenant resolution, class image removal, exact booking links, malformed links, reminder windows, stale delivery suppression, cleanup retention/claim order/key restrictions and storage retry. The guarded isolated MongoDB runner includes final-seat competition, failed/duplicate booking rollback, booking IDOR, reminder dedupe/rescheduling/cancellation, trainer changes, media binding/deletion races, and manual attendance without GPS while QR location requirements remain enforced.

Integration media rows are synthetic fixtures and do not prove a live S3 upload or real device push delivery. External S3, Firebase and installed-device results must be reported separately.
