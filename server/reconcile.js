import { applyStripeEvent } from "./billing.js";
import { digest } from "./security.js";
export async function reconcileSubscriptions({ db, stripe, priceIds }) {
  if (!stripe) return;
  const subscriptions = db
    .prepare("SELECT stripe_id FROM subscriptions WHERE stripe_id IS NOT NULL AND status NOT IN ('canceled','incomplete_expired')")
    .all();
  for (const row of subscriptions) {
    const sub = await stripe.subscriptions.retrieve(row.stripe_id);
    const state = digest(
      JSON.stringify([
        sub.status,
        sub.cancel_at_period_end,
        sub.cancel_at,
        sub.items.data[0]?.current_period_end,
      ]),
    );
    await applyStripeEvent(
      { db, stripe, priceIds },
      {
        id: `reconcile:${sub.id}:${state}`,
        type: "customer.subscription.updated",
        data: { object: { id: sub.id } },
      },
    );
  }
}
