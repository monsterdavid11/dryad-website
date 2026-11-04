import Stripe from "stripe";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
import { readFileSync, existsSync } from "node:fs";
import { signer } from "./security.js";
import { reconcileSubscriptions } from "./reconcile.js";
import { activateRelease } from "./release-activation.js";
import { stripeSettings } from "./stripe-settings.js";
const production = process.env.NODE_ENV === "production";
if (production && !process.env.APP_ORIGIN?.startsWith("https://"))
  throw new Error("Production APP_ORIGIN must use HTTPS.");
const { key, mode: billingMode } = stripeSettings();
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
const signingPath = process.env.LICENSE_KEY_PATH || "./data/keys/license.pem";
const signing = existsSync(signingPath)
  ? signer(readFileSync(signingPath))
  : null;
const activated = await activateRelease(
  db,
  process.env.DRYAD_RELEASE_MANIFEST,
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
  signing,
);
if (activated)
  console.log(JSON.stringify({ event: "protected_release", ...activated }));
const app = createApp({
  db,
  production,
  demoMode: !production && process.env.DEMO_MODE !== "false",
  origin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  stripe: key ? new Stripe(key) : null,
  billingMode,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  priceIds: {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_YEARLY,
  },
  signing,
  allowDevLicenses: !production && process.env.DEV_LICENSES === "true",
  durableWebhooks: true,
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS) || 0,
  portalConfiguration: process.env.STRIPE_PORTAL_CONFIGURATION,
});
const stopWorker = app.locals.queue.start();
const reconcileTimer = key
  ? setInterval(
      () =>
        app.locals.queue.enqueue(
          "reconcile",
          {},
          "reconcile:" + Math.floor(Date.now() / 900000),
        ),
      900000,
    )
  : null;
app.locals.queue.handlers.reconcile = () =>
  reconcileSubscriptions({
    db,
    stripe: new Stripe(key),
    priceIds: {
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_YEARLY,
    },
  });
const server = app.listen(
  Number(process.env.PORT) || 3001,
  process.env.LISTEN_HOST || "127.0.0.1",
  () => console.log("Dryad API → http://127.0.0.1:" + server.address().port),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      stopWorker();
      if (reconcileTimer) clearInterval(reconcileTimer);
      db.close();
      process.exit(0);
    }),
  );
