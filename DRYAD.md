# Dryad — current implementation and local runbook

**Hosted preview update — 2026-10-31:** https://dryadclient.dev is deployed on Render with one paid Node service and a 1 GB persistent SQLite disk. Cloudflare DNS-only apex/www records are connected; www redirects to the apex. HTTPS and `/api/health` succeeded for both names. Stripe, SMTP and native signing are not configured on the hosted instance. The historical production-gap notes below still apply except for completed hosting/domain setup. See `DEPLOYMENT.md` and the project vault for deployment evidence.

## Product decisions

- $5.99 USD/month, or $48.16/year (33% off the annual monthly total, rounded to cents).
- One registered installation. A reset is allowed once every five days. Removing a device frees its slot immediately; the replacement can pair immediately, but another removal must wait until the reset cooldown ends.
- Cancel future renewals anytime; access lasts through the paid period. Payments are non-refundable except where applicable law requires otherwise.
- Owned domain: `dryadclient.dev` (user confirmed 2026-10-31). DNS, operator/support details, and hosting deployment remain to be configured. Agent setup status is recorded in `vault/Dryad-Clash/Cloudflare setup.md`.
- Keep the three concept videos. They were re-rendered with Dryad branding; they are still placeholders, not real gameplay footage.

## What is implemented

| Original increment | Current result | Remaining external/production work |
| --- | --- | --- |
| 1. Branding and product | Dryad website/native UI, final selected pricing, device/reset policy, billing policy page | Domain registration and operator contact |
| 2. Stripe | Checkout/portal integration, validated prices, signed webhooks, durable retries, periodic reconciliation, refund/dispute holds; hosted sandbox Checkout, renewal and cancellation tested | Production payment readiness and hosted failure/refund/dispute acceptance testing |
| 3. Native licensing | .NET 10 Windows launcher, browser approval, P-256 installation proof, rotating DPAPI-protected credentials, RSA-signed ten-minute leases, native expiry gate and revocation | Production Authenticode certificate/service; production signing key rotation/rebuild |
| 4. Usage and release delivery | Native cumulative session summaries, local outbox, authenticated deduplication, dashboard data, signed release manifests, short-lived single-use downloads, release-channel disable switch | Real-game acceptance testing; private object-storage adapter (current delivery uses private local files) |
| 5. Recovery and operations | Single-use verification/recovery links, SMTP adapter/local mail spool, account export, privacy page, persisted retry queue, operational CLI, backup/prune tooling, Dockerfile | SMTP credentials/domain verification, account-erasure/retention procedure, production operator/policies, hosted monitoring; PostgreSQL migration before multi-instance deployment |

The backend remains a **single-instance SQLite implementation**, not PostgreSQL. The Dockerfile is prepared but has not been built/tested on Docker here. The user owns dryadclient.dev; hosted infrastructure has not been provisioned by this setup. Live Stripe keys are deliberately refused. This is not yet ready to accept live subscribers.

## Start the website

```powershell
cd C:\Users\david\Dump\GameDump\ClashofClans\web
npm.cmd install
# .env has already been created. Never overwrite it with the example once credentials are added.
npm.cmd run dev
```

Use `http://127.0.0.1:5173` consistently. The origin check does not treat `localhost` as an alias. Features, login, account and purchase pages are joined by `/connect`, `/recover`, `/terms`, and `/privacy`.

Existing local SQLite data remains at `data/playoverlay.sqlite` for compatibility. Existing source/CMake target names and development DLL names also remain where useful; the customer-facing product is Dryad. Browser cookies were renamed, so old web sessions must log in again.

## Stripe CLI and prices

The official Stripe CLI is installed as a development dependency. From `web`:

```powershell
npx stripe login
npx stripe listen --all-snapshot --forward-to http://127.0.0.1:3001/api/billing/webhook
```

The listener prints `whsec_…`. Put that value in `STRIPE_WEBHOOK_SECRET` in `.env`, keep the listener running, and restart `npm run dev`. This is the **CLI listener's** secret, separate from the API key and from a hosted Dashboard webhook endpoint secret.

In Stripe test mode, configure recurring USD prices of 599 cents/month and 4816 cents/year. `.env` needs `STRIPE_SECRET_KEY=sk_test_…`, both price IDs, and the signing secret. No secret belongs in a `VITE_` variable, chat message, screenshot, or tracked file.

```powershell
node --env-file=.env tools/check-stripe.js
```

The test billing portal is configured. Hosted sandbox testing covered a successful card Checkout, test-clock renewal, portal cancellation at the paid-through timestamp, and subscription cancellation. After restarting the listener with `--all-snapshot`, both scheduled and immediate cancellation reached the backend directly. Earlier missed events were repaired through reconciliation; it now runs every fifteen minutes. Failure/refund/dispute paths have automated fixture coverage and still need hosted acceptance testing. Signed events are persisted before acknowledgment, then processed by the durable worker. Completed job payloads are erased. Failed jobs retry with backoff and become inspectable after eight attempts. A successful redirect never grants a subscription.

## Email verification and recovery

The Resend HTTPS transport and branded verification/recovery templates are implemented. See `EMAIL_DELIVERY.md` for provider selection and setup. Hosted DNS, credentials and actual receipt must be verified before reporting delivery as working.

For actual delivery, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM`. STARTTLS is required on non-implicit-TLS connections. Configure your provider's SPF/DKIM/DNS instructions before public use.

Without SMTP, **development only** writes queued messages to ignored `web/data/mail/*.json`. Open the local message file and follow its link. These files contain private recovery links; never publish them. Production does not fall back to local mail delivery.

Account settings offers verification and account-data export. `/recover` accepts password-recovery requests and single-use emailed links. Password resets invalidate browser and launcher credentials. Password changes invalidate other browser sessions and all native refresh credentials. Re-pairing the same installation after explicit browser approval does not consume another device slot.

## Local launcher and native builds

The development signing private key is ignored at `web/data/keys/license.pem`. Its public key is pinned in `src/dryad_public_key.h` and embedded in the launcher. `npm run init:keys` initializes a missing local key and regenerates public pins. Do not distribute the private key. Production must use a separately protected signing key and rebuild both native verifier and launcher with its public key.

The supported .NET 10 SDK is installed locally in `web/.tools/dotnet`. The standalone launcher is:

`launcher/bin/Release/net10.0-windows/win-x64/publish/Dryad.exe`

For local end-to-end testing without a paid Stripe subscription, **explicitly** set `DEV_LICENSES=true` in `.env`, register a normal account, verify its email, then grant a one-day local entitlement:

```powershell
node --env-file=.env tools/dev-membership.js you@example.com
```

No Stripe subscription is fabricated. Production never reads these development entitlements. Local launcher command:

```powershell
..\launcher\bin\Release\net10.0-windows\win-x64\publish\Dryad.exe --api http://127.0.0.1:5173 --development
```

Approve the displayed device in your browser. The launcher stores its private installation key and rotating refresh credential using per-user Windows DPAPI under `%LOCALAPPDATA%\Dryad`. It writes the signed `license.jwt` there and renews after five minutes. Keep it running. `--no-telemetry` disables sending usage. HTTP is allowed only with `--development` and a loopback origin.

Build the protected native release separately from existing development tests:

```powershell
cmake -S .. -B ..\build-dryad -G "Visual Studio 17 2022" -A x64 -DDRYAD_REQUIRE_LICENSE=ON
cmake --build ..\build-dryad --config Release --target PlayOverlayInjector DryadLicenseTest
```

This produces `build-dryad/Release/Dryad.dll` and `DryadInjector.exe`. The normal `build/` remains unlicensed for development regression testing. **Never distribute the unprotected development DLL as the paid release.**

The license gate checks the pinned RSA signature, issuer, audience, product, issued/expiry times, and a monotonic expiry deadline. Input scheduling and radius guides require a valid lease. Expiry requests a safe stop and releases held input through the existing cancellation path; it does not unload the DLL or crash the game. Native usage writes are local, small and throttled; networking stays in the launcher. There is no obfuscation or custom memory loader.

For manual local use, keep the protected DLL beside its matching injector. The launcher currently authorizes, refreshes, and verifies downloads; it does not automatically run the injector. An expired/revoked account cannot renew or download. Offline access ends at the existing lease's signed deadline, with no extra grace extension.

## Release catalog and downloads

Publish a protected build into ignored private server storage:

```powershell
node --env-file=.env tools/publish-release.js preview 0.2.0 ..\build-dryad\Release\Dryad.dll
```

The authenticated launcher requests an RSA-signed manifest and receives a single-use download URL valid for 60 seconds. Downloads recheck account/device state. The launcher verifies manifest signature, issuer, audience, expiry, source origin, size and SHA-256 before saving `%LOCALAPPDATA%\Dryad\Dryad.dll`. Place the matching injector beside that DLL when using it.

```powershell
..\launcher\bin\Release\net10.0-windows\win-x64\publish\Dryad.exe --api http://127.0.0.1:5173 --development --download preview
npm run ops -- disable-release preview
```

Disabling a channel invalidates outstanding downloads for that channel. This prototype does not perform Authenticode signing; a certificate or signing-service account is still required. Retain rollback releases deliberately. A checksum and signed manifest do not replace Windows publisher signing.

## Usage data

The protected overlay publishes cumulative counters per session/day in `%LOCALAPPDATA%\Dryad\outbox`. Resource gains use the existing verified resource readings and add back verified wall spending. The launcher drains summaries after authentication and during its refresh loop. Server-side proof-of-key requests authenticate each batch; `(device, session, sequence)` and cumulative-counter validation prevent retries from double-counting. The website reads actual reports for normal accounts; the demo remains labeled sample data.

Usage is client-reported, not trusted evidence of payment or license entitlement. No screenshots, input logs, game credentials or raw hardware serials are collected by this integration.

## Operations and checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run ops -- status
npm.cmd run ops -- retry <failed-job-id>
npm.cmd run ops -- backup C:\absolute\private\backup.sqlite
npm.cmd run ops -- prune
node --env-file=.env tools/readiness.js
```

`prune` removes raw usage events older than 90 days, completed jobs older than seven days, and expired credentials/challenges/recovery links. Daily usage aggregates are retained with the account. Schedule pruning and encrypted offsite backups when hosting is chosen. Restore testing and an erasure procedure remain production tasks.

The Windows integration test runs the real launcher and C++ verifier against an isolated HTTP/SQLite fixture. It is skipped on machines without those built artifacts; run the native and .NET builds first. Other tests cover cookies, Origin validation, ownership, rotation/reuse detection, verification and recovery, device limits/cooldown, usage deduplication, controlled downloads, and durable retries.

## Domain and deployment

The user owns `dryadclient.dev`. Verify registrar nameserver delegation, Cloudflare zone activation and HTTPS hosting before changing the public app origin. See `vault/Dryad-Clash/Cloudflare setup.md` for agent setup status.

Recommended eventual hosting: [Render Node + managed PostgreSQL](https://render.com/docs/service-types), [Cloudflare private R2](https://developers.cloudflare.com/r2/how-r2-works/), and a transactional SMTP provider. The current app cannot use PostgreSQL or R2 merely by setting a URL: their adapters/migration still need implementation and testing. For a single-instance staging deployment, Render's paid persistent disk can hold the current SQLite database/private release files; do not run multiple instances or use ephemeral storage.

Docker staging configuration needs `APP_ORIGIN=https://dryadclient.dev`, `LISTEN_HOST=0.0.0.0`, provider-appropriate `TRUST_PROXY_HOPS`, a persistent `/app/data` volume, signing key, test Stripe credentials, SMTP credentials, and HTTPS/domain setup. The Dockerfile is prepared but untested. Live Stripe credentials remain blocked until operational recovery, production storage/signing, policies and hosted payment tests are complete.

Official references: [Stripe CLI](https://github.com/stripe/stripe-cli), [subscription Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions?platform=web&ui=stripe-hosted), [webhook signatures](https://docs.stripe.com/webhooks/signature), [Render persistent disks](https://render.com/docs/disks).
