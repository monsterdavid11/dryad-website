import Stripe from "stripe";
import { openDatabase } from "../server/db.js";
import { reconcileSubscriptions } from "../server/reconcile.js";
import { stripeSettings } from "../server/stripe-settings.js";
const { key, mode } = stripeSettings();
if (!key) throw Error("Stripe key required.");
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
try {
  await reconcileSubscriptions({
    db,
    stripe: new Stripe(key),
    priceIds: {
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_YEARLY,
    },
  });
  console.log(
    `Reconciled local subscriptions with current Stripe ${mode} state.`,
  );
} catch (e) {
  console.error("Reconciliation failed: " + (e.code || "provider_error"));
  process.exitCode = 1;
} finally {
  db.close();
}
