# Dryad account email

## Verified hosted setup — 2026-10-31

Resend verified `dryadclient.dev` and all required sending DNS records. The live Render service uses `EMAIL_PROVIDER=resend`, sender `Dryad <accounts@dryadclient.dev>`, and a domain-restricted sending-only key. Open/click tracking is disabled; TLS is enforced. Cloudflare website records were preserved, with DMARC initially set to monitoring (`p=none`).

The deployed website's verification and password-reset flows both returned success, Resend marked both messages delivered, and the owner confirmed both arrived in the authorized inbox. The deployed runtime commit is `fdc5c11`. No private credentials, recovery links or recipient details are stored in this runbook.

## Implementation

Verification and password-reset requests use the durable SQLite email queue. Messages include a branded HTML version and a plain-text version with the same one-use link. Verification links expire after 24 hours; password-reset links expire after 20 minutes. Expired queued messages are discarded before contacting the provider. Requesting another link invalidates earlier links.

Supported transports:

- `EMAIL_PROVIDER=resend`: HTTPS requests to Resend. Requires `RESEND_API_KEY` and `EMAIL_FROM`. A stable idempotency key prevents duplicate accepted sends on queue retries within Resend's 24-hour deduplication window.
- `EMAIL_PROVIDER=smtp`: existing Nodemailer transport. Requires `SMTP_HOST` and `EMAIL_FROM`, plus provider credentials/TLS settings.
- Blank provider: selects Resend if its key is present, otherwise SMTP if configured. Development can spool locally without a provider; production never uses the spool.

`EMAIL_REPLY_TO` is optional and should only point to a monitored inbox. No support mailbox or incoming forwarding is configured by this integration. Provider errors are sanitized; recipient addresses, credentials and recovery-link contents are not included in retry logs. Successfully handled queue payloads are erased. Provider acceptance does not prove inbox placement.

## Resend setup

1. Create a free Resend account. Do not subscribe to a paid plan as part of this initial setup.
2. Add **dryadclient.dev** as a sending domain, using the US East region. Add only the exact SPF/return-path and DKIM records returned by Resend. Preserve website CNAMEs and existing MX/SPF records; do not guess DNS values. Do not enable receiving mail or click/open tracking for these authentication messages.
3. Verify sending DNS in Resend. If a temporary Full access setup key is used locally, keep it only in ignored `.env`, never `.env.example` or Git.
4. Create a **sending-only** key restricted to this domain. Save it privately in the Render service's environment as `RESEND_API_KEY`.
5. Set the non-sensitive Render variables below, preserving unrelated values, and deploy:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM=Dryad <accounts@dryadclient.dev>
```

The Blueprint manages the baseline infrastructure; provider secrets are configured separately in Render. No secret values belong in `render.yaml`. Omitted environment variables are preserved during Blueprint syncs.

6. Verify the deployed code, health endpoint and runtime logs. Send actual verification/recovery tests only to an explicitly authorized inbox. Confirm receipt, sender authentication, link expiry/single use, and password-recovery behavior. Keep message IDs or results as evidence, not private links or reset tokens.
7. Revoke any temporary Full access setup key after setup is finished. Keep domain-scoped sending credentials on Render.

## Operational checks

Use `npm run ops -- status` for failed email jobs. After correcting credentials, inspect/retry intended failed jobs with `npm run ops -- retry <id>`. Request a fresh recovery link if an earlier one expired. Monitor Resend's delivered/bounced/suppressed events and its account quota; queue completion means provider acceptance, not final delivery. No delivery-event webhook or admin inbox is implemented here.

Current setup and actual hosted acceptance results are recorded in the project vault. Automated tests use an injected provider fixture and never send real mail.

Official references: [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction), [send API](https://resend.com/docs/api-reference/emails/send-email), [API-key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key).
