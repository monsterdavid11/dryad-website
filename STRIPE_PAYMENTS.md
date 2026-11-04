# Stripe payments

Live billing preparation — 2026-11-03. Hosted activation awaits the merchant's
live key; do not infer activation from a source deployment alone.

Dryad charges USD $5.99 monthly or $48.16 yearly. Membership permits one device.
The billing portal lets customers update payment methods, view invoices and cancel
future renewals. Cancellation takes effect at period end. No plan switching or
quantity changes are enabled. Refunds remain a manual operator action under the
published policy.

## Configuration

The runtime defaults to test mode. `STRIPE_MODE=live` requires production, an HTTPS
origin, a matching live secret/restricted key, both recurring price IDs, a webhook
signing secret and a portal configuration ID. Never put any secret in `VITE_`
variables, Git, logs or this document. Production email and native release signing
settings are separate and must be preserved.

Local test credentials stay in ignored `.env`. Put the live setup credential only
in ignored `.env.stripe-live`. From `web/`, run:

```powershell
node --env-file=.env.stripe-live tools/setup-stripe-live.js
```

This checks account payment activation and creates/reuses a Dryad product,
matching live recurring prices, a dedicated portal configuration and a snapshot
webhook endpoint. It saves resulting settings privately without printing secrets
and does not create charges or subscriptions. The temporary setup process needs
permission to manage these resources. A restricted runtime key can subsequently
replace the setup key with the permissions needed for Checkout, customer records,
prices, subscriptions, charge lookups and portal sessions.

Merge the six `STRIPE_*` entries from the private live file into the existing
Dryad Render service and rebuild/deploy the reviewed code. Do not upload the
entire development `.env` or replace existing environment variables.

Webhook URL: `https://dryadclient.dev/api/billing/webhook`. Use its own signing
secret, never a localhost CLI listener secret. The setup script pins snapshot
payloads to the installed Stripe SDK's API version and subscribes to:

- `checkout.session.completed`
- `customer.subscription.created`, `.updated`, `.deleted`
- `invoice.paid`, `invoice.payment_failed`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`

Webhook signatures and mode are checked before durable queue insertion. Checkout
validates amount, currency, recurring interval and mode against the selected plan.
Provider subscription state determines access; visiting a success URL cannot grant
membership. Reconciliation runs every 15 minutes for known subscriptions.

## Acceptance and operations

Verify `/api/config` reports `billingReady=true` and `billingMode=live`, health is
healthy, and existing licensing remains ready. Check both prices and portal
cancellation settings through Stripe. A signed non-entitling diagnostic webhook
can verify endpoint reachability without creating a purchase. This does not prove
a card payment, a renewal or settlement.

A real payment test needs a purchaser to complete live Checkout with their own
payment details. Never use test cards in live mode. Confirm actual Stripe webhook
delivery, account activation, native download and period-end cancellation after
that purchase. Do not charge, refund or cancel an existing customer merely to test
configuration.

To disable new purchases, remove the runtime Stripe key and unset live mode, then
deploy. Coordinate how existing customers will retain billing-portal access and
how ongoing subscription events will be processed before using this as an incident
procedure; disabling the entire integration also disables those functions.
