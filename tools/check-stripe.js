import Stripe from "stripe";
import { plans } from "../server/plans.js";
import { readFileSync, writeFileSync } from "node:fs";
import { stripeSettings } from "../server/stripe-settings.js";
const { key, mode } = stripeSettings();
if (!key) throw Error("Configure a Stripe key first.");
const stripe = new Stripe(key);
for (const plan of plans) {
  const variable =
      plan.id === "monthly" ? "STRIPE_PRICE_MONTHLY" : "STRIPE_PRICE_YEARLY",
    id = process.env[variable];
  if (!id) {
    console.log(plan.id + ": price ID missing");
    continue;
  }
  try {
    const p = id.startsWith("si_")
      ? (await stripe.subscriptionItems.retrieve(id)).price
      : await stripe.prices.retrieve(id);
    const matches =
      p.livemode === (mode === "live") &&
      p.active &&
      p.currency === "usd" &&
      p.unit_amount === plan.amount &&
      p.recurring?.interval === plan.interval &&
      p.recurring.interval_count === 1;
    if (
      id.startsWith("si_") &&
      matches &&
      mode === "test" &&
      process.argv.includes("--fix")
    ) {
      const env = readFileSync(".env", "utf8").replace(
        new RegExp("^" + variable + "=.*$", "m"),
        variable + "=" + p.id,
      );
      writeFileSync(".env", env);
      console.log(
        plan.id +
          ": corrected subscription-item ID to its verified matching price ID.",
      );
    }
    console.log(
      JSON.stringify({
        plan: plan.id,
        configuredAmount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
        matches,
        priceIdConfigured: id.startsWith("price_"),
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        plan: plan.id,
        error: e.code || "request_failed",
        note: "A recurring Stripe Price ID (price_…) is required.",
      }),
    );
  }
}
console.log(
  "Webhook signing secret present: " +
    Boolean(process.env.STRIPE_WEBHOOK_SECRET),
);
