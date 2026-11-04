import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { signer, digest } from "./security.js";
import { jobQueue } from "./jobs.js";
import { applyStripeEvent } from "./billing.js";
import { backup } from "node:sqlite";
import Stripe from "stripe";
import { reconcileSubscriptions } from "./reconcile.js";
const origin = "http://127.0.0.1:5173";
import { fixture } from "./test-fixture.js";

test("hardware binding rejects missing identities, changed hardware, and inactive membership", async () => {
  const f = await fixture();
  try {
    const account = await f.register(),
      key = f.identity();
    f.grant(account.data.user);
    const missing = await f.request("/native/pair/start", {
      method: "POST",
      native: true,
      body: { name: "PC", publicKey: key.encoded },
    });
    assert.equal(missing.status, 400);
    const auth = await f.pair(key, account);
    assert.equal(
      JSON.parse(Buffer.from(auth.lease.split(".")[1], "base64url")).hardware,
      key.hardware,
    );
    const changed = { ...key, hardware: "0".repeat(64) };
    const pending = await f.start(changed);
    assert.equal(
      (
        await f.request("/account/pairing/approve", {
          method: "POST",
          cookie: account.cookie,
          body: { code: pending.data.userCode },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.native(changed, auth, "refresh", {
          refreshToken: auth.refreshToken,
        })
      ).status,
      403,
    );
    f.db
      .prepare("DELETE FROM dev_entitlements WHERE user_id=?")
      .run(account.data.user.id);
    assert.equal(
      (
        await f.native(key, auth, "refresh", {
          refreshToken: auth.refreshToken,
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});
test("native login verifies email, enforces device limits/reset cooldown, binds proofs and revokes reused refresh tokens", async () => {
  const f = await fixture();
  try {
    const account = await f.register(),
      key = f.identity(),
      p = await f.start(key);
    assert.equal(
      (
        await f.request("/account/pairing/approve", {
          method: "POST",
          cookie: account.cookie,
          body: { code: p.data.userCode },
        })
      ).status,
      403,
    );
    f.grant(account.data.user);
    const auth = await f.pair(key, account);
    const [header, payload, signature] = auth.lease.split(".");
    assert.equal(
      verify(
        "sha256",
        Buffer.from(header + "." + payload),
        f.signing.publicKey,
        Buffer.from(signature, "base64url"),
      ),
      true,
    );
    assert.equal(
      JSON.parse(Buffer.from(payload, "base64url")).aud,
      "dryad-overlay",
    );
    const other = f.identity(),
      blocked = await f.start(other);
    assert.equal(
      (
        await f.request("/account/pairing/approve", {
          method: "POST",
          cookie: account.cookie,
          body: { code: blocked.data.userCode },
        })
      ).status,
      409,
    );
    const rotated = await f.native(key, auth, "refresh", {
      refreshToken: auth.refreshToken,
    });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.refreshToken, auth.refreshToken);
    assert.equal(
      (
        await f.native(other, auth, "refresh", {
          refreshToken: rotated.data.refreshToken,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.native(key, auth, "refresh", {
          refreshToken: auth.refreshToken,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.native(key, rotated.data, "refresh", {
          refreshToken: rotated.data.refreshToken,
        })
      ).status,
      401,
    );
    // Same installation can re-authenticate after explicit browser approval without consuming another slot.
    const reauthenticated = await f.pair(key, account);
    assert.equal(reauthenticated.deviceId, auth.deviceId);
    assert.equal(
      (
        await f.request("/account/devices/" + auth.deviceId, {
          method: "DELETE",
          cookie: account.cookie,
        })
      ).status,
      200,
    );
    const replacement = await f.pair(other, account);
    assert.equal(
      (
        await f.request("/account/devices/" + replacement.deviceId, {
          method: "DELETE",
          cookie: account.cookie,
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});
test("authenticated usage deduplicates snapshots; controlled releases expire and are disabled on revocation", async () => {
  const f = await fixture();
  const dir = mkdtempSync(resolve("data/test-release-"));
  try {
    const a = await f.register();
    f.grant(a.data.user);
    const key = f.identity(),
      auth = await f.pair(key, a),
      event = {
        sessionId: randomUUID(),
        sequence: 1,
        day: new Date().toISOString().slice(0, 10),
        script: "Farming loop",
        seconds: 60,
        runs: 1,
        gold: 100,
        elixir: 200,
        walls: 0,
      };
    assert.equal(
      (
        await f.native(key, auth, "telemetry", {
          refreshToken: auth.refreshToken,
          event,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.native(key, auth, "telemetry", {
          refreshToken: auth.refreshToken,
          event,
        })
      ).data.duplicate,
      true,
    );
    assert.equal(
      (
        await f.native(key, auth, "telemetry", {
          refreshToken: auth.refreshToken,
          event: { ...event, sequence: 2, seconds: 120, gold: 200 },
        })
      ).status,
      200,
    );
    const account = await f.request("/account", { cookie: a.cookie });
    assert.equal(account.data.usage.length, 1);
    assert.equal(account.data.usage[0].gold, 200);
    assert.equal(
      (
        await f.native(key, auth, "telemetry", {
          refreshToken: auth.refreshToken,
          event: { ...event, sequence: 3, gold: 1 },
        })
      ).status,
      409,
    );
    const bytes = Buffer.alloc(2048, 7),
      path = resolve(dir, "Dryad.dll");
    writeFileSync(path, bytes);
    f.db
      .prepare("INSERT INTO release_catalog VALUES(?,?,?,?,?,1)")
      .run("stable", "0.2.0", path, digest(bytes), bytes.length);
    const manifest = await f.native(key, auth, "manifest", {
      refreshToken: auth.refreshToken,
    });
    assert.equal(manifest.status, 200);
    const claims = JSON.parse(
      Buffer.from(manifest.data.manifest.split(".")[1], "base64url"),
    );
    const route = new URL(claims.url).pathname.replace("/api", "");
    assert.equal((await f.request(route, { native: true })).status, 200);
    assert.equal((await f.request(route, { native: true })).status, 401);
    f.db
      .prepare("INSERT INTO billing_holds VALUES(?,?,?)")
      .run("test-hold", a.data.user.id, "Dispute");
    assert.equal(
      (
        await f.native(key, auth, "manifest", {
          refreshToken: auth.refreshToken,
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("verification/recovery tokens are single-use and reset revokes all browser/native credentials", async () => {
  const f = await fixture();
  try {
    const a = await f.register();
    await f.request("/account/verify-email", {
      method: "POST",
      cookie: a.cookie,
    });
    const email = JSON.parse(
      f.db.prepare("SELECT payload FROM jobs WHERE kind='email'").get().payload,
    );
    const url = email.text.match(/http[^\s]+/)[0],
      token = new URL(url).searchParams.get("token");
    assert.equal(
      (await f.request("/auth/recover", { method: "POST", body: { token } }))
        .status,
      200,
    );
    assert.equal(
      (await f.request("/auth/recover", { method: "POST", body: { token } }))
        .status,
      400,
    );
    await f.request("/auth/forgot", {
      method: "POST",
      body: { email: a.data.user.email },
    });
    const job = f.db
      .prepare(
        "SELECT payload FROM jobs WHERE kind='email' ORDER BY created DESC LIMIT 1",
      )
      .get();
    const reset = new URL(
      JSON.parse(job.payload).text.match(/http[^\s]+/)[0],
    ).searchParams.get("token");
    assert.equal(
      (
        await f.request("/auth/recover", {
          method: "POST",
          body: { token: reset, password: "a new Dryad test password" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/account", { cookie: a.cookie })).status,
      401,
    );
    assert.equal(
      (
        await f.request("/auth/recover", {
          method: "POST",
          body: { token: reset, password: "another new long password" },
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("durable jobs survive reconstruction, retry failures and erase completed secret payloads", async () => {
  const db = openDatabase(":memory:");
  try {
    const q = jobQueue(db, {
      email: async () => {
        throw Error("offline");
      },
    });
    q.enqueue("email", { token: "secret" }, "job-test");
    await q.tick();
    assert.equal(db.prepare("SELECT state FROM jobs").get().state, "pending");
    db.prepare("UPDATE jobs SET available=0").run();
    let delivered = 0;
    const restarted = jobQueue(db, {
      email: async () => {
        delivered++;
      },
    });
    await restarted.tick();
    assert.equal(delivered, 1);
    assert.equal(db.prepare("SELECT payload FROM jobs").get().payload, "{}");
  } finally {
    db.close();
  }
});
test("SQLite backups restore account and operational records", async () => {
  const db = openDatabase(":memory:"),
    dir = mkdtempSync(resolve("data/backup-test-"));
  try {
    db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
      "test-audit",
      null,
      "backup_test",
      Date.now(),
      "{}",
    );
    const target = resolve(dir, "restore.sqlite");
    await backup(db, target);
    const restored = openDatabase(target);
    try {
      assert.equal(
        restored.prepare("SELECT action FROM audit").get().action,
        "backup_test",
      );
    } finally {
      restored.close();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("refund/dispute holds are idempotent and only won disputes are released", async () => {
  const f = await fixture();
  try {
    const a = await f.register();
    f.db
      .prepare("UPDATE users SET stripe_customer=? WHERE id=?")
      .run("cus_holds", a.data.user.id);
    const stripe = {
      charges: { retrieve: async () => ({ customer: "cus_holds" }) },
    };
    const send = (id, type, object) =>
      applyStripeEvent(
        { db: f.db, stripe, priceIds: {} },
        { id, type, data: { object } },
      );
    await send("evt_dispute", "charge.dispute.created", {
      id: "dp_test",
      charge: "ch_test",
    });
    await send("evt_dispute", "charge.dispute.created", {
      id: "dp_test",
      charge: "ch_test",
    });
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM billing_holds").get().n,
      1,
    );
    await send("evt_lost", "charge.dispute.closed", {
      id: "dp_test",
      charge: "ch_test",
      status: "lost",
    });
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM billing_holds").get().n,
      1,
    );
    await send("evt_won", "charge.dispute.closed", {
      id: "dp_test",
      charge: "ch_test",
      status: "won",
    });
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM billing_holds").get().n,
      0,
    );
    await send("evt_refund", "charge.refunded", {
      id: "ch_refund",
      customer: "cus_holds",
      amount: 599,
      amount_refunded: 599,
    });
    assert.equal(
      (await f.request("/account", { cookie: a.cookie })).data.billingHold,
      true,
    );
  } finally {
    await f.close();
  }
});
test("reconciliation recovers a missed cancellation without trusting browser claims", async () => {
  const f = await fixture();
  try {
    const a = await f.register();
    f.db
      .prepare("UPDATE users SET stripe_customer=? WHERE id=?")
      .run("cus_reconcile", a.data.user.id);
    const until = Math.floor(Date.now() / 1000) + 86400;
    f.db
      .prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,0)")
      .run(a.data.user.id, "sub_reconcile", "active", "monthly", until);
    const stripe = {
      subscriptions: {
        retrieve: async () => ({
          id: "sub_reconcile",
          customer: "cus_reconcile",
          metadata: { userId: a.data.user.id },
          status: "canceled",
          items: {
            data: [{ price: { id: "price_month" }, current_period_end: until }],
          },
        }),
      },
    };
    await reconcileSubscriptions({
      db: f.db,
      stripe,
      priceIds: { monthly: "price_month" },
    });
    assert.equal(
      (await f.request("/account", { cookie: a.cookie })).data.subscription
        .status,
      "canceled",
    );
  } finally {
    await f.close();
  }
});
test("signed webhooks are durably acknowledged before provider processing", async () => {
  const stripe = new Stripe("sk_test_placeholder"),
    secret = "whsec_durable_test",
    f = await fixture({ stripe, webhookSecret: secret, durableWebhooks: true });
  try {
    let calls = 0;
    f.app.locals.queue.handlers.stripe = async () => {
      calls++;
    };
    const payload = JSON.stringify({
      id: "evt_durable",
      type: "invoice.paid",
      data: { object: {} },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const r = await fetch(f.base + "/api/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });
    assert.equal(r.status, 200);
    assert.equal(calls, 0);
    assert.equal(
      f.db.prepare("SELECT state FROM jobs WHERE id='stripe:evt_durable'").get()
        .state,
      "pending",
    );
    await f.app.locals.queue.tick();
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
