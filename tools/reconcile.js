import Stripe from "stripe";
import { openDatabase } from "../server/db.js";
import { reconcileSubscriptions } from "../server/reconcile.js";
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
  throw Error("Stripe test key required.");
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
try {
  await reconcileSubscriptions({
    db,
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
    priceIds: {
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_YEARLY,
    },
  });
  console.log("Reconciled local subscriptions with current Stripe test state.");
} catch (e) {
  console.error("Reconciliation failed: " + (e.code || "provider_error"));
  process.exitCode = 1;
} finally {
  db.close();
}
