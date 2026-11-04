export function stripeSettings(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  const mode = env.STRIPE_MODE || "test";
  if (!["test", "live"].includes(mode))
    throw new Error("STRIPE_MODE must be test or live.");
  if (key && !new RegExp(`^(sk|rk)_${mode}_`).test(key))
    throw new Error("Stripe key does not match STRIPE_MODE.");
  if (mode === "live") {
    if (
      env.NODE_ENV !== "production" ||
      !env.APP_ORIGIN?.startsWith("https://")
    )
      throw new Error("Live billing requires production and an HTTPS origin.");
    for (const name of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_MONTHLY",
      "STRIPE_PRICE_YEARLY",
      "STRIPE_PORTAL_CONFIGURATION",
    ])
      if (!env[name]) throw new Error(`Live billing requires ${name}.`);
  }
  return { key, mode };
}
