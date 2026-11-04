# Dryad hosted preview

## Live billing activated — 2026-11-03

Stripe is now configured for real USD $5.99/month and $48.16/year purchases on the
existing Render service. Runtime `c5322b0`, deploy `dep-dblag12jnfac73fd7q1g`, is live.
The restricted live key and dedicated hosted webhook secret are stored in Render;
email, protected release signing and persistent data were preserved. Health,
live billing readiness, signature handling, both unpaid live Checkout plans and
portal period-end cancellation settings passed. Diagnostic sessions were expired;
no actual purchase was submitted. See `STRIPE_PAYMENTS.md` for acceptance limits.
This supersedes older billing-disabled statements below.

## Protected release activated — 2026-11-03

Dryad 1.0.0 licensing and the stable protected DLL catalog are live on the existing
`dryad-website` service. Runtime commit: `c3590c72bb92249ba103e6aeb5ef47200b0f44c2`.
Successful deploy: `dep-dbl9jrl9el5s73ccdvr0`.

The matching production signing key is installed as a Render secret file;
`LICENSE_KEY_PATH=/etc/secrets/release-1.0.0.pem`. Only the public key ID
`c1fd258abf9ab390` is recorded here. Email settings and the existing disk/database
were preserved. `DRYAD_RELEASE_MANIFEST=./release-assets/stable.json` verifies the
binary and installs it into private persistent release storage at startup. A
database backup is created before a changed release is registered. Restarts of the
same release preserve an operator's explicit catalog disable.

HTTPS health and `/api/native/status` passed: licensing ready, hardware binding
enabled, development licenses disabled, stable version 1.0.0 and matching DLL
SHA-256. Hosted negative checks passed for missing hardware, unapproved pairing,
account approval without login and unauthenticated download. The test pairing is
unapproved and expires automatically; no accounts, emails or memberships changed.

**Billing remains separate:** Stripe is still unconfigured and live keys remain
blocked by the application. Licensing readiness does not grant anyone a membership.
A real entitled-account positive hosted lease/download flow remains pending that
setup. Existing local production-key launcher/native integration coverage passed.
The older preview notes below are historical snapshots.

This repository contains the website and Node API only. The native overlay and launcher remain in the parent development workspace.

## Current status — 2026-10-31

The initial Blueprint is deployed in the **Dryad** workspace as `dryad-website`. The runtime deploy of commit `d44e75e` is live with its 1 GB disk. `https://dryadclient.dev` serves the website, and `https://www.dryadclient.dev` redirects to it. Both HTTPS health checks return 200 with `{"ok":true}`. Cloudflare records remain DNS only. Do not create a second service when continuing setup.

Email delivery is now configured through Resend, with actual verification/recovery inbox receipt confirmed on 2026-10-31; see `EMAIL_DELIVERY.md`. Runtime commit `fdc5c11` includes that integration. Stripe payments and native license signing remain unconfigured on Render. The original steps below describe the configuration and remaining work.

## Render

The root `render.yaml` declares one Node 24 web service in Virginia, the entry paid compute plan, and a 1 GB persistent disk. The API serves the built React app and runs its durable queue in the same process. All durable data is under `/opt/render/project/src/data`. This setup supports one instance and briefly interrupts traffic during deployments.

Create the Blueprint from this private repository in the **Dryad** workspace. Connect Render to the GitHub repository if prompted. Review its monthly charge before applying. Keep the Hobby workspace tier unless you deliberately need another tier.

Build: `npm ci --include=dev && npm run build`. Start: `npm start`. Health: `/api/health`.

No local accounts, keys, payment credentials, release DLLs, or database are uploaded. Stripe payments and native signing are unconfigured on the first deployment. Email verification/recovery delivery also requires SMTP configuration. The initial hosted site is a preview, not a ready-to-sell membership service.

## Domain

After the service exists, use its actual `.onrender.com` hostname as the target for Cloudflare CNAME records at `@` and `www`. Initially set both records to **DNS only** so Render can verify ownership and issue TLS. Verify the custom domains in Render, then check HTTPS, frontend routes and `/api/health`.

The canonical origin is `https://dryadclient.dev`. Add the apex domain first so `www` redirects to it. Do not change the local `.env` origin; localhost remains for development.

## Before enabling subscriptions

- Rotate any Stripe test key previously entered in an example file. Keep the replacement only in private local/Render settings.
- Configure test Checkout prices, test API key, portal and a **hosted** webhook endpoint at `https://dryadclient.dev/api/billing/webhook`. Its signing secret differs from the local Stripe listener's secret.
- Configure a verified SMTP sender and test delivery/recovery.
- Provision a separate signing key as a protected secret file and rebuild client public pins before native distribution.
- Configure consistent encrypted database backups and test restore. Render disk snapshots are not database backups.
- Finish hosted payment acceptance, operator/support details, retention/erasure and release signing. Live Stripe keys remain blocked by the application.

See `DRYAD.md` for existing implementation and production limitations. Do not commit `.env`, data, private key files, or test results.
