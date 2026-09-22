# Figma Screen Inventory

Source: `GETFIT4U — Gym Management`, file key `PxxsIfQpUURErsizTupZVe`. Visual reference uses Plus Jakarta Sans, navy `#07111F`, lime `#84CC16`, light canvas `#F8FAFC/#FCFDFD`, translucent cards, 12–24px radii and role-specific navigation.

| Area | Screens / states | Primary interactions |
|---|---|---|
| Brand/system | Cover, tokens, light/dark themes, components, responsive variants | Component states, theme variants |
| Authentication | Splash, welcome, login, register, phone login, OTP, forgot/reset, verification, success/error/loading, logout | Password/Google/OTP sign-in, recovery, role routing |
| Public | Landing, discovery list, gym cards, gym detail, gallery, plans, reviews | Search/filter/sort, favorite, WhatsApp, directions, subscribe |
| Maps | Desktop 60/40 map-list, mobile map/bottom sheet; permission/loading/unavailable/low-accuracy/out-of-range/within-radius | Geolocate, recenter, marker select, directions, geofence decision |
| Member mobile | Home, Explore, Subscriptions, Attendance, Attendance QR, Classes, Notifications, Profile, Reviews, Referrals, Support, Security | Subscribe, QR display, booking, review, referral, preferences |
| Gym owner | Dashboard, Profile, Members, Member detail, Plans, Subscriptions, Attendance, Scanner, Classes, Trainers, Payments, Revenue, Messages, WhatsApp, Notifications, Offers, Ads, Reports, Settings, Support | CRUD, scanner validation, campaigns, reporting |
| Trainer | Dashboard, Clients, Today's Sessions, Upcoming Sessions, Schedule, Workout Plans, Progress, Session Attendance, Messages, Notifications, Profile/Settings | Assign workout, manage sessions, record progress/attendance |
| Admin | Dashboard, Gyms, Owners, Users, Platform plans, Subscriptions, Payments, Revenue, Refunds, Notifications, WhatsApp, Ads, Reviews, Reports, Monitoring, Audit, Settings | Approve/reject/suspend, reconcile, moderate, monitor |
| Payment | Plan selection, quote/checkout, Razorpay, success, failed/retry, receipt/invoice/refund | Provider checkout, server verification, receipt |
| Feedback | Skeleton, empty, error, offline, denied, success, modal/drawer, toast variants | Retry, dismiss, contextual CTA |

## Breakpoints

- Mobile: 390×844, bottom navigation and sheets.
- Tablet: 768×1024, collapsible navigation and touch-friendly responsive tables.
- Desktop: 1440×1024, persistent/collapsible left sidebar.
- Large desktop: 1920×1080, wider content grids without stretching readable text.

## Component inventory

Buttons, inputs, search, select, checkbox, radio, toggle, tabs, cards, KPI cards, tables, badges, avatars, tooltips, toasts, modal/drawer/bottom sheet, date/calendar, charts, map markers, navigation, pagination, upload, QR, notification item/detail, conversation row, message bubble and location status card.

