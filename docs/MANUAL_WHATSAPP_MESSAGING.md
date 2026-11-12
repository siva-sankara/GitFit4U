# Gym Owner WhatsApp Messaging

Open **Owner → Messages → WhatsApp Messaging**, at `/owner/whatsapp`.

This page uses WhatsApp click-to-chat links. It does not send through Meta, Twilio, a background worker or an unofficial automation provider. No new environment variables, packages or paid services are required. Existing WhatsApp Business features and the Members list reminder button retain their existing behavior.

## Owner workflow

- Search by name, mobile number or membership plan; filter and paginate using the existing gym membership rules.
- Member results use compact rows in their own scroll area. Search, selection controls and pagination stay outside that area. The page remains scrollable when the composer or a smaller screen needs more space; changing filters or pages resets the member list to the top.
- Selection is limited to visible members. Searching, changing filters or changing pages clears the selection. Switching gym/account also clears drafts and progress.
- Choose a preset or write a custom message. Variable buttons insert at the text cursor. Preview each selected member's personalized message.
- For one member, **Open in WhatsApp** opens their chat with the previewed text. **Normal Chat** can open a plain chat or use the custom draft.
- For multiple members, **Send Individually** shows a confirmation, then one recipient at a time. Open that chat, send in WhatsApp, return, and choose **Mark Complete & Next**. Invalid numbers or missing message details are skipped with a reason. Nothing automatically opens the next chat.
- Progress uses Pending, WhatsApp opened, Processed and Skipped. It stays in memory while this page remains open; leaving or reloading clears it. Closing the dialog preserves it until the page is left. This is not persistent delivery history.
- **Share via WhatsApp** uses a separate generic message. WhatsApp chooses the recipients independently of the GETFIT4U selection. Member variables cannot be resolved into this generic message.
- Configure an existing group under **Owner → Gym Profile Settings → Notification and communication settings → WhatsApp member group**. The owner creates the group in WhatsApp and stores its name and invite link. GETFIT4U prepares invitations; it does not create groups or add members automatically.

## Data and validation

`GET /api/v1/owner/members?view=messaging` reuses the existing member filters and pagination, with a minimal projection for this page. The authenticated gym context and actual gym ownership determine access; request-provided gym IDs cannot override them. Subscription populations are gym-scoped, and pending invitations disclose only the gym-entered contact details. Account-name searches are restricted to accepted members in the current gym.

`GET` and `PATCH /api/v1/owner/communication/whatsapp-group` require the existing owner authentication, gym context and relevant gym permission. The group link is private by default in the Gym schema. Validation accepts only HTTPS invite links on the exact `chat.whatsapp.com` host with an invite code. Clearing both fields removes the group settings.

The existing phone normalization and URL construction were extracted to a shared backend utility, retaining the legacy behavior. Manual messaging additionally rejects ambiguous or malformed phone input before returning a chat URL. The frontend validates that URL and appends `encodeURIComponent(message)`; it never sends an arbitrary phone number to a messaging endpoint.

Presets and supported variables live in `frontend/src/services/manualWhatsApp.ts`. Missing data or unfinished variables block the affected message. Historical payment totals are not treated as renewal quotes; `renewalAmount` is unavailable until an authoritative quote exists. The default payment preset includes no amount.

## Files created

- `backend/src/utils/whatsappDeepLink.ts`
- `backend/src/services/manualWhatsAppService.ts`
- `backend/src/services/manualWhatsAppService.test.ts`
- `backend/src/controllers/manualWhatsAppController.ts`
- `frontend/src/services/manualWhatsApp.ts`
- `frontend/src/services/manualWhatsApp.test.ts`
- `frontend/src/components/WhatsAppGroupSettings.tsx`
- `frontend/src/pages/owner/OwnerWhatsAppMessagingPage.tsx`
- `frontend/src/pages/owner/OwnerWhatsAppMessagingPage.test.tsx`
- `frontend/src/styles/manual-whatsapp.css`
- `docs/MANUAL_WHATSAPP_MESSAGING.md`

## Files modified

- `backend/src/controllers/ownerController.ts`
- `backend/src/controllers/ownerMembersFilters.test.ts`
- `backend/src/models/Gym.ts`
- `backend/src/routes/ownerRoutes.ts`
- `backend/src/services/memberReminderService.ts`
- `backend/src/services/whatsappConnectionService.ts`
- `frontend/src/components/StatusBadge.tsx`
- `frontend/src/components/WorkspaceBreadcrumbs.tsx`
- `frontend/src/layouts/WorkspaceLayout.tsx`
- `frontend/src/pages/live/LiveWorkspace.tsx`
- `frontend/src/pages/owner/GymProfileEditor.tsx`
- `frontend/src/pages/shared/MessagesPage.tsx`
- `frontend/src/styles/whatsapp.css`

## Verification

Backend: 105 test files / 813 tests passed. Frontend: 611 tests passed in the full run; its one existing localhost proxy test exceeded the 5-second timeout under concurrent load and passed on an isolated rerun (612 tests verified overall). Both TypeScript production builds and both lint commands passed.

Tests cover personalized presets, missing variables, phone normalization, URL encoding, group links, owner isolation, pending-member privacy, selection, filtering, pagination, generic sharing, single chats and the one-at-a-time recipient workflow. Existing Member List WhatsApp tests pass unchanged.

The compact-layout follow-up was checked with frontend lint, the TypeScript production build and all eight messaging-page / existing Members-button component tests, including resetting the member list scroll position on filter and page changes.

Responsive styles use existing light/dark theme tokens, cards, narrow-screen breakpoints and sticky mobile actions. Actual browser appearance has not been verified: automatic approval review rejected the optional local Chrome layout check because the requirements prohibit browser automation. No WhatsApp messages were sent during verification.
