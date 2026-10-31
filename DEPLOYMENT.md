# Dryad hosted preview

This repository contains the website and Node API only. The native overlay and launcher remain in the parent development workspace.

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
