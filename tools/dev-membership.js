import { openDatabase } from "../server/db.js";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DEV_LICENSES !== "true"
)
  throw Error(
    "Requires local DEV_LICENSES=true. Never use this for paid subscriptions.",
  );
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
const user = db
  .prepare("SELECT id FROM users WHERE email=? AND demo=0")
  .get(process.argv[2]);
if (!user) throw Error("Register a normal local account first.");
db.prepare(
  "INSERT INTO dev_entitlements VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET expires=excluded.expires",
).run(user.id, Math.floor(Date.now() / 1000) + 86400);
console.log(
  "Granted 24-hour LOCAL DEVELOPMENT license. No Stripe subscription was created.",
);
db.close();
