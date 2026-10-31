import { existsSync } from "node:fs";
const required = [
  "APP_ORIGIN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_YEARLY",
  "EMAIL_FROM",
];
const emailProvider =
  process.env.EMAIL_PROVIDER ||
  (process.env.RESEND_API_KEY ? "resend" : "smtp");
required.push(
  ...(emailProvider === "resend"
    ? ["RESEND_API_KEY"]
    : ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]),
);
const missing = required.filter((k) => !process.env[k]);
console.log(
  JSON.stringify(
    {
      missing,
      emailProvider,
      httpsOrigin: Boolean(process.env.APP_ORIGIN?.startsWith("https://")),
      signingKeyPresent: existsSync(
        process.env.LICENSE_KEY_PATH || "./data/keys/license.pem",
      ),
      paymentsMode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
        ? "test"
        : "not configured",
      livePaymentsEnabled: false,
      database:
        "SQLite — single-instance local implementation; PostgreSQL adapter not implemented",
      domain: process.env.APP_ORIGIN || "https://dryadclient.dev",
      authenticode: "Certificate and signing not configured",
    },
    null,
    2,
  ),
);
