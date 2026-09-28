# GETFIT4U public legal policies

Publication date: 29 September 2026

## Published routes

The following pages are public, use the shared GETFIT4U header and footer, and do not require authentication:

| Document | Route |
| --- | --- |
| Terms & Policies hub | `/terms-and-policies` |
| Terms & Conditions | `/terms-and-conditions` |
| Privacy Policy | `/privacy-policy` |
| Refund & Cancellation Policy | `/refund-cancellation-policy` |
| Data Deletion Instructions | `/data-deletion` |

The footer links every document directly. Legacy `/legal/terms` and `/legal/privacy` links redirect to the corresponding published document.

The pages are responsive, keyboard navigable, compatible with the application's light and dark themes, and use structured React content without HTML injection. Every document includes an effective date, last-updated date, breadcrumb, table of contents, Contact-page link, and policy-hub link.

## Meta Tech Provider verification links

After deployment to the production HTTPS domain, enter these public URLs in the relevant Meta App Dashboard fields. If the production domain changes, replace only the origin and keep the route paths stable.

- Privacy Policy URL: `https://www.getfit4u.in/privacy-policy`
- Terms of Service URL: `https://www.getfit4u.in/terms-and-conditions`
- User Data Deletion / Data Deletion Instructions URL: `https://www.getfit4u.in/data-deletion`
- Refund Policy URL, if requested: `https://www.getfit4u.in/refund-cancellation-policy`

The Privacy Policy describes GETFIT4U's WhatsApp Business Platform processing, including phone number, messages, consent, template/campaign identifiers, timestamps, and delivery/read/failure/reply status. The Data Deletion page gives signed-in and public request paths and has a dedicated **Meta and WhatsApp data deletion** section.

These URLs are application routes, not proof that the current production deployment has been released. Verify each URL in a signed-out browser after deployment. Meta activation and business verification must still be completed by an authorised person in the organisation's Meta account.

## Product coverage represented in the policies

The policy text was written against the repository's implemented flows and covers:

- member, trainer, gym owner, staff, and admin accounts and RBAC;
- profiles, fitness data, emergency contacts, gyms, plans, memberships, classes, attendance, and gym QR scanning;
- online provider payments, offline gym payments, invoices, refunds, promotions, freezes, and reactivations;
- direct messages, support conversations, posts, stories, reviews, attachments, broadcasts, and notifications;
- camera, device location, browser storage, session and device security data;
- storage/media processing, Google identity, payment, mapping/geocoding, Firebase push, and Meta/WhatsApp services;
- access, correction, consent, marketing opt-out, retention, account closure, and deletion requests.

The public policies do not claim that cancellation automatically guarantees a refund, do not promise a processing time controlled by a bank or provider, do not expose secrets, and do not claim that closing an account cancels a separate gym membership.

## Release checklist

Before submitting the URLs to Meta or treating the documents as the organisation's final legal instruments:

1. Deploy the frontend and confirm all five routes return the application over public HTTPS when opened directly while signed out.
2. Confirm the public Contact page displays a monitored support channel and that support agents can recognise and process the subjects `Data deletion request` and `Meta/WhatsApp data deletion`.
3. Insert the registered operator's legal name, registered address, and any required grievance/privacy contact when those verified details are available. They were intentionally not invented in the application text.
4. Have qualified counsel review the documents for the operator's entity, locations, customer categories, commercial model, tax position, and gym contracts.
5. Preserve prior versions when policies change and update both displayed dates.
6. Test the Privacy Policy and Data Deletion URLs in Meta's dashboard without an authenticated GETFIT4U session.

## Routing and security notes

`publicPolicyRoutes` is a pathless route group rendered by `PublicLayout` outside `GuestRoute`, `ProtectedRoute`, and role workspaces. Auth-return and workspace-path validation explicitly recognise the published routes, including during gym-owner onboarding.

The existing Vercel SPA rewrite serves application routes through `index.html` while excluding APIs and asset files. Deployment regression coverage includes every published policy path. Visiting a policy page does not record consent, mutate an account, or invoke a protected API.
