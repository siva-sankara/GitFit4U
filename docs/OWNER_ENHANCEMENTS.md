# Owner, membership, classes and revenue changes

## Members

`GET /api/v1/owner/members` retains pagination and adds tenant-scoped `membershipStatus`, `planId` (public ID), and `trainerId` (database ID or `none`) filters. `q` is a literal name/contact/member-code search, not an executable regular expression. The existing `status` filter still refers to the member profile. Responses include `meta.timezone` and `meta.serverNow` for consistent date-only presentation and the inclusive seven-calendar-day expiry indicator.

The list combines plan and membership status into one column. The small status control has a keyboard/touch-accessible tooltip. Assigned-trainer details remain references; `trainerAssignedAt` is recorded only on a new or changed assignment. Historical assignments without a reliable date display “Not recorded.” Staff without financial permission do not receive financial fields or see a payment panel. Trainer-option requests require both member-management and gym-reading permission.

## Classes

Existing create/list/update APIs are preserved. `POST /api/v1/owner/classes/:id/cancel` takes `{ reason }`. Creation and updates use the same schema and transactional service: tenant-scoped active trainers, increasing start/end times, future new sessions, capacity at least current bookings, and no premature completion. Blank optional room/trainer inputs are accepted; invalid end times produce an `endsAt` field error instead of an invisible form-level error.

Cancellation retains class and booking records, cancels active bookings, resets booked capacity, and queues one centralized notification batch in the database transaction. Repeated cancellation does not notify again. Schedule/trainer changes notify affected booked members. Owner cards support real creation, editing and cancellation. Member cards use existing authenticated booking/cancellation APIs. `GET /api/v1/users/classes?day=YYYY-MM-DD` filters upcoming sessions using each gym's timezone.

## Dashboard and revenue

The dashboard includes the actual platform subscription snapshot, member limit/usage, expiry and renewal link. Payment execution remains in the platform renewal checkout flow.

`GET /api/v1/owner/revenue` accepts `period=today|7d|month|last-month|3m|6m|year|custom|all`; custom filters use `from`/`to` inclusive gym-local calendar dates. The returned end boundary is exclusive next-day midnight, including daylight-saving transitions. Revenue remains captured membership receipts minus processed refunds of those receipts; platform-plan fees are excluded. Pending payments are separate. Chart points and totals include actual transaction counts; the peak annotation uses the largest returned net daily value.

## Database and verification

Additive fields: `MemberProfile.trainerAssignedAt`; `ClassSession.description`, `cancelledAt`, `cancellationReason`. New indexes cover trainer assignment/current subscription and gym/status/class date. Run the existing `npm run db:migrate` after backup/review to create indexes. No historical data is deleted or guessed by this change.

Focused tests cover class validation/authorization/cancellation, member filters and query-injection rejection, timezone/DST revenue boundaries, membership status accessibility, owner dashboard subscription data, member detail permissions, and modal-backed class creation. Live camera permissions and real payment-provider transfers require their separate deployment checks.
