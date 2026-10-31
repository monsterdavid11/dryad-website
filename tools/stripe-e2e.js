// Explicitly scoped to test data created by this script. Never use a live key.
import Stripe from "stripe";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../server/db.js";
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
  throw Error("Stripe TEST key required.");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY),
  origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  path = resolve("test-results/stripe-e2e.json");
mkdirSync(resolve("test-results"), { recursive: true });
let state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const save = () =>
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
async function api(route, body) {
  const r = await fetch(origin + "/api" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(state.cookie ? { Cookie: state.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Local API request failed");
  return { data: d, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function main() {
  const action = process.argv[2] || "status";
  if (action === "start") {
    if (state.customer)
      throw Error("Existing test run present; use status or cleanup.");
    const email = `dryad-e2e-${Date.now()}@example.com`,
      registered = await api("/auth/register", {
        name: "Dryad Checkout Test",
        email,
        password: randomBytes(32).toString("hex"),
      });
    state = {
      email,
      userId: registered.data.user.id,
      cookie: registered.cookie,
      createdBy: "dryad-e2e",
    };
    save();
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: "Dryad local E2E",
    });
    state.clock = clock.id;
    save();
    const customer = await stripe.customers.create({
      email,
      name: "Dryad local test customer",
      test_clock: clock.id,
      metadata: { userId: state.userId, dryad_e2e: "true" },
    });
    state.customer = customer.id;
    save();
    const db = openDatabase(
      process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
    );
    db.prepare("UPDATE users SET stripe_customer=? WHERE id=?").run(
      customer.id,
      state.userId,
    );
    db.close();
    if (!process.env.STRIPE_PORTAL_CONFIGURATION) {
      const portal = await stripe.billingPortal.configurations.create({
        name: "Dryad local test portal",
        metadata: { dryad_e2e: "true" },
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      });
      state.portalConfiguration = portal.id;
      save();
      let env = readFileSync(".env", "utf8");
      env += `\nSTRIPE_PORTAL_CONFIGURATION=${portal.id}\n`;
      writeFileSync(".env", env);
    }
    const checkout = await api("/billing/checkout", { plan: "monthly" });
    state.checkoutUrl = checkout.data.url;
    save();
    console.log(JSON.stringify({ checkoutUrl: checkout.data.url }));
  } else if (action === "checkout") {
    const checkout = await api("/billing/checkout", { plan: "monthly" });
    state.checkoutUrl = checkout.data.url;
    save();
    console.log(JSON.stringify({ checkoutUrl: checkout.data.url }));
  } else if (action === "status") {
    if (!state.customer) throw Error("Start a test run first.");
    const subs = await stripe.subscriptions.list({
      customer: state.customer,
      status: "all",
    });
    const account = await api("/account");
    console.log(
      JSON.stringify({
        provider: subs.data.map((s) => ({
          status: s.status,
          cancelAtEnd: s.cancel_at_period_end,
          periodEnd: s.items.data[0]?.current_period_end,
        })),
        local: account.data.subscription,
        jobs: (() => {
          const db = openDatabase(
            process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
          );
          const rows = db
            .prepare(
              "SELECT kind,state,count(*) AS count FROM jobs GROUP BY kind,state",
            )
            .all();
          db.close();
          return rows;
        })(),
      }),
    );
  } else if (action === "portal") {
    const p = await api("/billing/portal", {});
    console.log(JSON.stringify({ portalUrl: p.data.url }));
  } else if (action === "advance") {
    const subs = await stripe.subscriptions.list({
        customer: state.customer,
        status: "all",
      }),
      sub = subs.data.find((s) => s.status === "active");
    if (!sub) throw Error("No active E2E subscription.");
    state.subscription = sub.id;
    save();
    const next = sub.items.data[0].current_period_end + 3600;
    await stripe.testHelpers.testClocks.advance(state.clock, {
      frozen_time: next,
    });
    console.log(
      "Test clock advanced past the subscription period. Poll status after Stripe finishes simulation.",
    );
  } else if(action==='notification-start'){
    if(state.createdBy!=='dryad-e2e')throw Error('Scoped test data required.');
    const prior=await stripe.subscriptions.list({customer:state.customer,status:'all'});const method=prior.data.find(s=>s.default_payment_method)?.default_payment_method;if(!method)throw Error('Expected the sandbox payment method from Checkout.');
    const sub=await stripe.subscriptions.create({customer:state.customer,items:[{price:process.env.STRIPE_PRICE_MONTHLY}],default_payment_method:typeof method==='string'?method:method.id,metadata:{userId:state.userId,dryad_e2e:'true'}});state.notificationSub=sub.id;save();console.log('Created a scoped sandbox subscription to verify listener delivery.');
  } else if(action==='notification-schedule'){
    await stripe.subscriptions.update(state.notificationSub,{cancel_at_period_end:true});console.log('Scheduled cancellation on the scoped sandbox subscription.');
  } else if(action==='notification-cancel'){
    await stripe.subscriptions.cancel(state.notificationSub);console.log('Canceled the scoped sandbox notification-test subscription.');
  } else if (action === "cleanup") {
    if (state.createdBy !== "dryad-e2e")
      throw Error("Refusing to touch unscoped Stripe data.");
    if (state.customer) {
      const customer = await stripe.customers.retrieve(state.customer);
      if (!customer.deleted && customer.metadata?.dryad_e2e !== "true")
        throw Error("Customer is not scoped to this test.");
    }
    if (state.clock) await stripe.testHelpers.testClocks.del(state.clock);
    state.cleaned = true;
    save();
    console.log(
      "Removed the E2E test clock and its Stripe test customer/subscriptions. Local account retained as test evidence.",
    );
  } else throw Error("Use start, status, portal, advance or cleanup.");
}
main().catch((e) => {
  console.error(
    JSON.stringify({ error: e.code || e.message || "test_failed" }),
  );
  process.exitCode = 1;
});
