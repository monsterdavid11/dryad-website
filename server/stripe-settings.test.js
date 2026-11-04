import { test } from "node:test";
import assert from "node:assert/strict";
import { stripeSettings } from "./stripe-settings.js";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import Stripe from "stripe";

test("live billing requires explicit mode, matching credentials, HTTPS and complete configuration", () => {
  assert.equal(stripeSettings({}).mode, "test");
  assert.throws(
    () => stripeSettings({ STRIPE_SECRET_KEY: "sk_live_placeholder" }),
    /does not match/,
  );
  const env = {
    STRIPE_MODE: "live",
    STRIPE_SECRET_KEY: "rk_live_placeholder",
    NODE_ENV: "production",
    APP_ORIGIN: "https://dryadclient.dev",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    STRIPE_PRICE_MONTHLY: "price_month",
    STRIPE_PRICE_YEARLY: "price_year",
    STRIPE_PORTAL_CONFIGURATION: "bpc_placeholder",
  };
  assert.equal(stripeSettings(env).mode, "live");
  assert.throws(
    () => stripeSettings({ ...env, STRIPE_SECRET_KEY: "sk_test_placeholder" }),
    /does not match/,
  );
  assert.throws(
    () => stripeSettings({ ...env, NODE_ENV: "development" }),
    /production/,
  );
  assert.throws(
    () => stripeSettings({ ...env, STRIPE_PORTAL_CONFIGURATION: "" }),
    /STRIPE_PORTAL_CONFIGURATION/,
  );
});

test("live webhook accepts signed live events and rejects signed sandbox events before queueing", async () => {
  const db = openDatabase(":memory:"),
    stripe = new Stripe("sk_test_placeholder"),
    secret = "whsec_mode_test";
  const app = createApp({
    db,
    stripe,
    webhookSecret: secret,
    billingMode: "live",
    production: true,
    demoMode: false,
    durableWebhooks: true,
    emailSender: async () => {},
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const livemode of [false, true]) {
      const payload = JSON.stringify({
        id: `evt_mode_${livemode}`,
        livemode,
        type: "checkout.session.completed",
        data: { object: {} },
      });
      const response = await fetch(base + "/api/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripe.webhooks.generateTestHeaderString({
            payload,
            secret,
          }),
        },
        body: payload,
      });
      assert.equal(response.status, livemode ? 200 : 400);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM jobs").get().n, 1);
    const config = await (await fetch(base + "/api/config")).json();
    assert.equal(config.billingMode, "live");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
