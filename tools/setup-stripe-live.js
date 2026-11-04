// Run from web: node --env-file=.env.stripe-live tools/setup-stripe-live.js
// Never prints credentials. Reuses Dryad-owned resources; does not charge anyone.
import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";
import { plans } from "../server/plans.js";
const path = ".env.stripe-live";
if (!/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ""))
  throw new Error("Add a live secret key to ignored .env.stripe-live first.");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const events = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
];
const origin = "https://dryadclient.dev";
const persist = (key, value) => {
  let text = readFileSync(path, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text)
    ? text.replace(pattern, `${key}=${value}`)
    : text.trimEnd() + `\n${key}=${value}\n`;
  writeFileSync(path, text);
};
try {
  const account = await stripe.accounts.retrieve();
  console.log(
    JSON.stringify({
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    }),
  );
  if (!account.charges_enabled)
    throw new Error(
      "Finish Stripe account activation before enabling purchases.",
    );
  const products = await stripe.products.list({ limit: 100, active: true });
  const product =
    products.data.find((p) => p.metadata.dryad_app === "dryadclient.dev") ||
    (await stripe.products.create(
      {
        name: "Dryad membership",
        description: "Dryad overlay membership for one registered device.",
        metadata: { dryad_app: "dryadclient.dev" },
      },
      { idempotencyKey: "dryad-live-product-v1" },
    ));
  for (const plan of plans) {
    const lookup = `dryad_${plan.id}_v1`;
    const found = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
    const price =
      found.data[0] ||
      (await stripe.prices.create(
        {
          product: product.id,
          currency: "usd",
          unit_amount: plan.amount,
          recurring: { interval: plan.interval },
          lookup_key: lookup,
          metadata: { dryad_app: "dryadclient.dev", plan: plan.id },
        },
        { idempotencyKey: `dryad-live-price-${plan.id}-v1` },
      ));
    if (
      !price.active ||
      !price.livemode ||
      price.product !== product.id ||
      price.currency !== "usd" ||
      price.unit_amount !== plan.amount ||
      price.recurring?.interval !== plan.interval ||
      price.recurring.interval_count !== 1
    )
      throw new Error(
        `Existing ${plan.id} price does not match Dryad pricing.`,
      );
    persist(
      plan.id === "monthly" ? "STRIPE_PRICE_MONTHLY" : "STRIPE_PRICE_YEARLY",
      price.id,
    );
    console.log(
      JSON.stringify({
        plan: plan.id,
        amount: price.unit_amount,
        currency: price.currency,
        live: price.livemode,
        priceId: price.id,
      }),
    );
  }
  const configurations = await stripe.billingPortal.configurations.list({
    limit: 100,
  });
  const current = configurations.data.find(
    (c) => c.metadata?.dryad_app === "dryadclient.dev",
  );
  const portalSettings = {
    business_profile: {
      headline: "Manage your Dryad membership",
      privacy_policy_url: origin + "/privacy",
      terms_of_service_url: origin + "/terms",
    },
    default_return_url: origin + "/account?tab=billing",
    features: {
      customer_update: { enabled: true, allowed_updates: ["name", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: false,
          options: ["too_expensive", "other"],
        },
      },
      subscription_update: { enabled: false },
    },
    metadata: { dryad_app: "dryadclient.dev" },
  };
  const portal = current
    ? await stripe.billingPortal.configurations.update(current.id, {
        ...portalSettings,
        active: true,
      })
    : await stripe.billingPortal.configurations.create(portalSettings, {
        idempotencyKey: "dryad-live-portal-v3",
      });
  persist("STRIPE_PORTAL_CONFIGURATION", portal.id);
  const url = origin + "/api/billing/webhook";
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  let endpoint = endpoints.data.find((e) => e.url === url);
  if (endpoint) {
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw new Error(
        "Hosted webhook already exists. Add its signing secret from Stripe to .env.stripe-live before rerunning.",
      );
    if (endpoint.metadata?.dryad_app !== "dryadclient.dev")
      throw new Error(
        "Existing webhook is not managed by this setup; review it in Stripe.",
      );
    endpoint = await stripe.webhookEndpoints.update(endpoint.id, {
      enabled_events: events,
      disabled: false,
    });
  } else {
    endpoint = await stripe.webhookEndpoints.create(
      {
        url,
        enabled_events: events,
        api_version: stripe.getApiField("version"),
        description: "Dryad live subscription billing",
        metadata: { dryad_app: "dryadclient.dev" },
      },
      { idempotencyKey: "dryad-live-webhook-v1" },
    );
    persist("STRIPE_WEBHOOK_SECRET", endpoint.secret);
  }
  persist("STRIPE_MODE", "live");
  console.log(
    JSON.stringify({
      portalId: portal.id,
      webhookId: endpoint.id,
      webhookUrl: endpoint.url,
      enabledEvents: endpoint.enabled_events,
      settingsSaved: true,
    }),
  );
} catch (error) {
  // Provider error bodies can contain private account information.
  console.error(
    error.type
      ? `Stripe setup failed: ${error.code || error.type}; parameter: ${error.param || "unspecified"}`
      : error.message,
  );
  if (error.type === "StripeInvalidRequestError")
    console.error(
      String(error.message).replace(
        /(?:sk|rk)_(?:live|test)_\S+|whsec_\S+|[\w.+-]+@[\w.-]+/g,
        "[redacted]",
      ),
    );
  process.exitCode = 1;
}
