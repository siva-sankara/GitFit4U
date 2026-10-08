# Signup/login OTP dual delivery

## Runtime design

GETFIT4U owns one six-digit signup/login challenge. The existing platform WhatsApp Cloud API sender and the Microsoft 365 adapter receive the same code, expiry, purpose and challenge version. The verifier stored on `OtpChallenge` is an HMAC; retryable delivery data is stored separately as an AES-256-GCM encrypted, short-lived `AuthOtpDelivery` envelope. Plaintext codes are not returned by production APIs or stored in browser storage.

`AUTH_OTP_DUAL_DELIVERY_ENABLED=false` is the safe default. Password login and the existing mobile-only path remain available while Microsoft 365 is being authorized.

The common code is delivery redundancy, not MFA. It does not prove which channel the person read, so shared-code verification does not mark both phone and email verified. Login and recovery accept an email-or-phone identifier, but every destination is resolved only from the server-side account and used only when independently verified. Email-only verified accounts are supported without inventing a phone destination. Admin OTP login remains prohibited.

## Microsoft 365 and GoDaddy prerequisites

Before enabling the flag, the tenant administrator must confirm:

- `support@getfit4u.in` is a real Exchange Online user/shared mailbox, not only an alias, forwarding address or distribution group.
- The mailbox belongs to the tenant identified by `M365_TENANT_ID`, can send externally, and the configured UPN is valid for `POST /users/{UPN}/sendMail`.
- The administrator can manage Microsoft Entra app registrations and Exchange Online Application RBAC. With a GoDaddy-managed tenant, an ordinary mailbox user may not have these rights; obtain the required Entra/Exchange administrator access from the tenant administrator or GoDaddy without migrating the tenant or changing DNS.
- SPF has exactly one valid record, DKIM is enabled for `getfit4u.in`, and DMARC alignment, quarantine and message trace have been reviewed. Do not publish guessed DNS values.

Microsoft references: [client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow), [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), and [Exchange Online Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

## Register `GETFIT4U OTP Mailer`

1. Open Microsoft Entra admin center in the tenant that owns the support mailbox.
2. Create a single-tenant app registration named `GETFIT4U OTP Mailer`.
3. Record the Directory/Tenant ID as `M365_TENANT_ID` and Application/Client ID as `M365_CLIENT_ID`.
4. Create a client secret only if the deployment cannot use a certificate/federated identity. Store the secret **value**, not its Secret ID, as `M365_CLIENT_SECRET`; record its expiry in the operations calendar and secret manager. The current adapter implements client-secret authentication. Certificate/federated authentication requires extending the adapter before rollout.
5. Do not grant `Mail.Read`, `Mail.ReadWrite`, SMTP or directory-read permissions. Prefer Exchange Application RBAC with only `Application Mail.Send`, scoped to the support mailbox. Do not leave an additional tenant-wide Entra `Mail.Send` application grant; grants from the two systems are additive.

Use an Exchange Online administrator session. Replace every placeholder and inspect the selected objects before running writes:

```powershell
Connect-ExchangeOnline

# These are different IDs. ObjectId must be the Enterprise Application
# service-principal object ID, not the App Registration object ID.
New-ServicePrincipal `
  -AppId <APPLICATION_CLIENT_ID> `
  -ObjectId <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -DisplayName "GETFIT4U OTP Mailer"

# Create a mail-enabled security group containing only support@getfit4u.in.
$scopeGroup = Get-DistributionGroup -Identity "GETFIT4U OTP Mailbox Scope"
New-ManagementScope `
  -Name "GETFIT4U OTP Mailbox Scope" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '$($scopeGroup.DistinguishedName)'"

New-ManagementRoleAssignment `
  -Name "GETFIT4U OTP Mail.Send" `
  -App <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Role "Application Mail.Send" `
  -CustomResourceScope "GETFIT4U OTP Mailbox Scope"

Test-ServicePrincipalAuthorization `
  -Identity <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Resource support@getfit4u.in | Format-Table

# This must report InScope=False for a controlled unrelated mailbox.
Test-ServicePrincipalAuthorization `
  -Identity <ENTERPRISE_APP_SERVICE_PRINCIPAL_OBJECT_ID> `
  -Resource <UNRELATED_TEST_MAILBOX> | Format-Table
```

Application RBAC changes may take time to reach the authorization cache even when the test cmdlet succeeds.

## Backend configuration

Set these only in the backend secret store:

```dotenv
AUTH_OTP_DUAL_DELIVERY_ENABLED=false
AUTH_OTP_EMAIL_PROVIDER=microsoft_graph
AUTH_OTP_TTL_SECONDS=300
AUTH_OTP_RESEND_COOLDOWN_SECONDS=60
AUTH_OTP_MAX_ATTEMPTS=5
AUTH_OTP_HMAC_SECRET=<independent-production-secret>
AUTH_OTP_DELIVERY_ENCRYPTION_KEY=<different-independent-production-secret>

M365_TENANT_ID=<directory-tenant-id>
M365_CLIENT_ID=<application-client-id>
M365_CLIENT_SECRET=<secret-value-not-secret-id>
M365_SENDER_MAILBOX=support@getfit4u.in
M365_FROM_EMAIL=support@getfit4u.in
M365_FROM_NAME=GETFIT4U
M365_REPLY_TO=support@getfit4u.in
```

Keep the existing `WHATSAPP_*` platform sender and approved five-minute `AUTHENTICATION` template configuration unchanged. None of these values belongs in a `VITE_` variable.

## Worker and rollout

The request path immediately attempts both durable intents. Retryable intents remain in MongoDB and require a long-running worker:

```text
npm run start:auth-otp-worker
```

Do not assume a Vercel function will keep this process alive after a response. Deploy one worker instance on a persistent runtime with the same backend secrets and MongoDB access. The lease makes concurrent worker claims safe; retries keep the original code and expiry and stop at challenge expiry.

Roll out in this order:

1. Deploy schema/code and the worker with the feature flag off.
2. Validate the Meta platform sender/template and Microsoft token acquisition.
3. Confirm `support@getfit4u.in` succeeds and an unrelated mailbox is out of scope.
4. Enable the flag in a non-production environment and test controlled User and Gym Owner signups/logins.
5. Confirm mobile and email contain the identical code, verify once, reject replay, and record delivery timing.
6. Enable production only after mailbox/device tests pass. A Graph `202 Accepted` is submission, not recipient delivery.

Rollback by setting `AUTH_OTP_DUAL_DELIVERY_ENABLED=false` and redeploying. Existing sessions remain valid. In-flight dual challenges remain verifiable until their original five-minute expiry; no new email intents are created.

## Troubleshooting and rotation

- `M365_CLIENT_CREDENTIAL_INVALID`: verify tenant/client IDs, use the secret **value**, and check expiry.
- `M365_MAIL_SEND_FORBIDDEN`: verify the Exchange service-principal pointer, `Application Mail.Send` assignment and mailbox scope; remove conflicting unscoped grants.
- `M365_MAILBOX_NOT_FOUND`: confirm the real mailbox UPN. An alias or forwarder is not interchangeable with a mailbox.
- `M365_RATE_LIMITED`: inspect Exchange limits and `Retry-After`; the worker never retries beyond code expiry.
- `M365_SUBMISSION_UNKNOWN`: do not generate a replacement immediately. The accepted message may still arrive; the existing code stays usable.
- Accepted but not received: inspect Exchange message trace, junk/quarantine, mailbox health, SPF/DKIM/DMARC and external recipient policy.

For client-secret rotation, create a second secret, update `M365_CLIENT_SECRET` in the secret store, redeploy API and worker, validate a controlled send, then remove the old secret. Never paste the credential into tickets, logs, source control or chat.
