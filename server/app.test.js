import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
const origin = "http://127.0.0.1:5173";
async function fixture(options = {}) {
  const db = openDatabase(":memory:");
  const app = createApp({ db, origin, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(
    path,
    { method = "GET", body, cookie, headers = {} } = {},
  ) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        origin,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  return { db, request, base, close };
}
const account = {
  name: "Test Member",
  email: "member@example.com",
  password: "a long test password",
};
test("accounts: persistence, cookie flags, isolation, origin validation, password rotation and logout", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/account")).status, 401);
    assert.equal(
      (
        await f.request("/auth/register", {
          method: "POST",
          body: account,
          headers: { origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const registered = await f.request("/auth/register", {
      method: "POST",
      body: account,
    });
    assert.equal(registered.status, 201);
    const cookie = registered.cookie;
    assert.match(registered.headers.get("set-cookie"), /HttpOnly/);
    assert.match(registered.headers.get("set-cookie"), /SameSite=Lax/);
    const stored = f.db.prepare("SELECT * FROM users").get();
    assert.notEqual(stored.password, account.password);
    assert.equal(
      f.db.prepare("SELECT token_hash FROM sessions").get().token_hash.length,
      64,
    );
    assert.equal(
      (await f.request("/auth/register", { method: "POST", body: account }))
        .status,
      409,
    );
    const second = await f.request("/auth/register", {
      method: "POST",
      body: { ...account, email: "other@example.com" },
    });
    f.db
      .prepare("INSERT INTO devices VALUES(?,?,?,?)")
      .run("private-device", stored.id, "My PC", new Date().toISOString());
    assert.equal(
      (
        await f.request("/account/devices/private-device", {
          method: "DELETE",
          cookie: second.cookie,
        })
      ).status,
      404,
    );
    const before = await f.request("/account", { cookie });
    assert.equal(before.data.usage.length, 0);
    assert.equal(before.data.subscription, null);
    assert.equal(
      (
        await f.request("/account", {
          method: "PATCH",
          cookie,
          body: { name: "Changed Name" },
        })
      ).data.user.name,
      "Changed Name",
    );
    assert.equal(
      (
        await f.request("/auth/login", {
          method: "POST",
          body: { email: account.email, password: "wrong" },
        })
      ).status,
      401,
    );
    const oldSession = await f.request("/auth/login", {
      method: "POST",
      body: account,
    });
    const rotated = await f.request("/account/password", {
      method: "POST",
      cookie,
      body: {
        currentPassword: account.password,
        newPassword: "a new long test password",
      },
    });
    assert.equal(rotated.status, 200);
    assert.equal(
      (await f.request("/account", { cookie: oldSession.cookie })).status,
      401,
    );
    assert.equal(
      (await f.request("/account", { cookie: rotated.cookie })).status,
      200,
    );
    assert.equal(
      (
        await f.request("/account/devices/private-device", {
          method: "DELETE",
          cookie: rotated.cookie,
        })
      ).status,
      200,
    );
    await f.request("/auth/logout", { method: "POST", cookie: rotated.cookie });
    assert.equal(
      (await f.request("/account", { cookie: rotated.cookie })).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("demo is labeled, read-only, cannot purchase, and is disabled for production", async () => {
  const f = await fixture();
  try {
    const demo = await f.request("/auth/demo", { method: "POST" });
    assert.equal(demo.data.user.demo, true);
    const data = await f.request("/account", { cookie: demo.cookie });
    assert.equal(data.data.usage.length, 14);
    assert.equal(data.data.subscription, null);
    assert.equal(
      (
        await f.request("/account", {
          method: "PATCH",
          cookie: demo.cookie,
          body: { name: "Overwrite" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/billing/checkout", {
          method: "POST",
          cookie: demo.cookie,
          body: { plan: "monthly" },
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
  const p = await fixture({ production: true, demoMode: false });
  try {
    assert.equal(
      (await p.request("/auth/demo", { method: "POST" })).status,
      404,
    );
  } finally {
    await p.close();
  }
});
test("checkout fails honestly without keys; a return URL never changes access", async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request("/auth/register", {
      method: "POST",
      body: account,
    });
    assert.equal(
      (
        await f.request("/billing/checkout", {
          method: "POST",
          cookie,
          body: { plan: "monthly" },
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await f.request("/billing/checkout", {
          method: "POST",
          cookie,
          body: { plan: "free" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/account?checkout=success", { cookie })).data
        .subscription,
      null,
    );
  } finally {
    await f.close();
  }
});
for (const billingMode of ["test", "live"])
  test(`Stripe ${billingMode}: server price validation, ownership, signed webhook, replay, status revocation and checkout reuse`, async () => {
    const verifier = new Stripe("sk_test_placeholder"),
      secret = "whsec_test_secret";
    let sub,
      createCount = 0,
      amount = 599,
      priceLive = billingMode === "live";
    const stripe = {
      webhooks: verifier.webhooks,
      prices: {
        retrieve: async () => ({
          id: "price_month",
          active: true,
          livemode: priceLive,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval: "month", interval_count: 1 },
        }),
      },
      customers: { create: async () => ({ id: "cus_test" }) },
      checkout: {
        sessions: {
          create: async () => {
            createCount++;
            return {
              id: "cs_test",
              url: "https://checkout.stripe.com/test",
              expires_at: Math.floor(Date.now() / 1000) + 1800,
            };
          },
          retrieve: async () => ({ status: "open" }),
        },
      },
      subscriptions: { retrieve: async () => sub },
    };
    const f = await fixture({
      stripe,
      billingMode,
      webhookSecret: secret,
      priceIds: { monthly: "price_month", yearly: "price_year" },
    });
    try {
      const { cookie, data } = await f.request("/auth/register", {
        method: "POST",
        body: account,
      });
      amount = 100;
      assert.equal(
        (
          await f.request("/billing/checkout", {
            method: "POST",
            cookie,
            body: { plan: "monthly" },
          })
        ).status,
        503,
      );
      amount = 599;
      priceLive = billingMode !== "live";
      assert.equal(
        (
          await f.request("/billing/checkout", {
            method: "POST",
            cookie,
            body: { plan: "monthly" },
          })
        ).status,
        503,
      );
      priceLive = billingMode === "live";
      assert.equal(
        (
          await f.request("/billing/checkout", {
            method: "POST",
            cookie,
            body: { plan: "monthly" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await f.request("/billing/checkout", {
            method: "POST",
            cookie,
            body: { plan: "monthly" },
          })
        ).status,
        200,
      );
      assert.equal(createCount, 1);
      sub = {
        id: "sub_test",
        customer: "cus_test",
        metadata: { userId: data.user.id },
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_month" },
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      };
      const send = async (id, valid = true) => {
        const payload = JSON.stringify({
          id,
          livemode: billingMode === "live",
          type: "customer.subscription.updated",
          data: { object: { id: "sub_test" } },
        });
        const signature = verifier.webhooks.generateTestHeaderString({
          payload,
          secret: valid ? secret : "wrong",
        });
        return fetch(f.base + "/api/billing/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "stripe-signature": signature,
          },
          body: payload,
        });
      };
      assert.equal((await send("evt_bad", false)).status, 400);
      assert.equal(
        (await f.request("/account", { cookie })).data.subscription,
        null,
      );
      assert.equal((await send("evt_1")).status, 200);
      assert.equal((await send("evt_1")).status, 200);
      assert.equal(
        f.db.prepare("SELECT count(*) AS n FROM stripe_events").get().n,
        1,
      );
      assert.equal(
        (await f.request("/account", { cookie })).data.subscription.status,
        "active",
      );
      assert.equal(
        (
          await f.request("/billing/checkout", {
            method: "POST",
            cookie,
            body: { plan: "monthly" },
          })
        ).status,
        409,
      );
      sub = {
        ...sub,
        cancel_at: Math.floor(Date.now() / 1000) + 3600,
        cancel_at_period_end: false,
      };
      assert.equal((await send("evt_scheduled_cancel")).status, 200);
      const scheduled = (await f.request("/account", { cookie })).data
        .subscription;
      assert.equal(scheduled.cancel_at_end, 1);
      assert.equal(scheduled.period_end, sub.cancel_at);
      sub = { ...sub, cancel_at: null, status: "past_due" };
      assert.equal((await send("evt_2")).status, 200);
      assert.equal(
        (await f.request("/account", { cookie })).data.subscription.status,
        "past_due",
      );
      sub = { ...sub, metadata: { userId: "someone-else" } };
      assert.equal((await send("evt_wrong_owner")).status, 400);
      // A delayed cancellation from an old subscription must not revoke a newer one.
      f.db
        .prepare(
          "UPDATE subscriptions SET stripe_id='sub_new',status='active' WHERE user_id=?",
        )
        .run(data.user.id);
      sub = { ...sub, status: "canceled", metadata: { userId: data.user.id } };
      assert.equal((await send("evt_old_canceled")).status, 200);
      assert.equal(
        (await f.request("/account", { cookie })).data.subscription.status,
        "active",
      );
    } finally {
      await f.close();
    }
  });
