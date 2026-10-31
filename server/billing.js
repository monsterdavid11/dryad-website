import { plans } from "./plans.js";
import { failure as fail } from "./security.js";
export async function applyStripeEvent({ db, stripe, priceIds }, event) {
  const query = (sql, ...args) => db.prepare(sql).get(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args);
  if (query("SELECT id FROM stripe_events WHERE id=?", event.id)) return;
  if (
    [
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(event.type)
  ) {
    const obj = event.data.object;
    const charge =
      event.type === "charge.refunded"
        ? obj
        : await stripe.charges.retrieve(
            typeof obj.charge === "string" ? obj.charge : obj.charge.id,
          );
    const customer =
      typeof charge.customer === "string"
        ? charge.customer
        : charge.customer?.id;
    const user = query(
      "SELECT id FROM users WHERE stripe_customer=?",
      customer,
    );
    if (!user)
      throw fail(409, "Billing account mapping requires reconciliation.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        event.type === "charge.refunded" &&
        charge.amount_refunded >= charge.amount
      )
        run(
          "INSERT OR IGNORE INTO billing_holds VALUES(?,?,?)",
          charge.id,
          user.id,
          "Full refund",
        );
      else if (event.type === "charge.dispute.created")
        run(
          "INSERT OR IGNORE INTO billing_holds VALUES(?,?,?)",
          obj.id,
          user.id,
          "Open dispute",
        );
      else if (event.type === "charge.dispute.closed" && obj.status === "won")
        run("DELETE FROM billing_holds WHERE id=?", obj.id);
      run(
        "INSERT INTO stripe_events VALUES(?,?)",
        event.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      return;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const supported = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (!supported.includes(event.type)) return;
  const object = event.data.object;
  const subId = event.type.startsWith("customer.subscription.")
    ? object.id
    : object.subscription || object.parent?.subscription_details?.subscription;
  if (!subId) return;
  // Fetch current provider state; redirects and client-submitted values never grant access.
  const sub = await stripe.subscriptions.retrieve(
    typeof subId === "string" ? subId : subId.id,
  );
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = query(
    "SELECT * FROM users WHERE stripe_customer=? AND demo=0",
    customer,
  );
  const item = sub.items.data[0];
  const plan = plans.find(
    (p) => priceIds[p.id] && priceIds[p.id] === item?.price.id,
  );
  if (!user || !plan || sub.metadata?.userId !== user.id)
    throw fail(400, "Subscription ownership or price did not match.");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!query("SELECT id FROM stripe_events WHERE id=?", event.id)) {
      const previous = query(
        "SELECT stripe_id,status FROM subscriptions WHERE user_id=?",
        user.id,
      );
      const differentActiveSubscription =
        previous &&
        previous.stripe_id !== sub.id &&
        !["canceled", "incomplete_expired"].includes(previous.status);
      if (
        differentActiveSubscription &&
        !["canceled", "incomplete_expired"].includes(sub.status)
      )
        throw fail(409, "Conflicting subscription requires reconciliation.");
      if (!differentActiveSubscription) {
        run(
          "INSERT INTO subscriptions(user_id,stripe_id,status,plan,period_end,cancel_at_end) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stripe_id=excluded.stripe_id,status=excluded.status,plan=excluded.plan,period_end=excluded.period_end,cancel_at_end=excluded.cancel_at_end",
          user.id,
          sub.id,
          sub.status,
          plan.id,
          Math.min(
            item.current_period_end || sub.current_period_end || 0,
            sub.cancel_at || Number.MAX_SAFE_INTEGER,
          ),
          Number(Boolean(sub.cancel_at_period_end || sub.cancel_at)),
        );
      }
      run(
        "INSERT INTO stripe_events VALUES(?,?)",
        event.id,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
