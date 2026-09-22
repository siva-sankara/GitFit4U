# Current feature integration matrix

| Area | Database integration | Remaining boundary |
| --- | --- | --- |
| Authentication | Signup, login, OTP, recovery, refresh, roles and sessions | SMS provider acceptance; browser E2E |
| Public discovery | Search, nearby filters, pagination, details, favorites, reviews | Real catalogue must be onboarded |
| Member workspace | Profile, memberships, attendance, bookings, payments, invoices, support, notifications | Provider checkout acceptance |
| Owner workspace | Gym onboarding/editing, documents, members, trainers, plans, classes, scanner, dashboards | Object-storage acceptance |
| Trainer workspace | Assigned clients, workouts/assignments, progress, schedules | Recommendations and detailed workout logs incomplete |
| Admin workspace | Registration reviews, users/gyms, platform plans, audit and moderation | Operational procedures and deployment acceptance |
| Messaging | Scoped contacts, persistent conversations and paginated messages | Browser and multi-instance socket acceptance |
| Campaigns | Persistent drafts and queued in-app delivery | WhatsApp/email/push delivery incomplete |
| Commercial extensions | Stored offers, ads, referrals, refund and settlement records | Redemption, attribution, reward and financial automation incomplete |

Active routes do not import the old demonstration catalogue. See [QA report](final-qa-report.md) for verified checks and deployment limitations. This matrix supersedes earlier prototype-based IMPLEMENTED labels.
