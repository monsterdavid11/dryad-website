import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-fixture.js";
import { createApp } from "./app.js";

test("failed logins are normalized per email, survive app recreation, expire and do not retain raw identifiers", async () => {
  const f = await fixture({ rateLimits: { auth: 50, login: 2 } });
  let server;
  try {
    await f.register();
    const body = { email: " MEMBER@DRYAD.TEST ", password: "wrong password" };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await f.request("/auth/login", { method: "POST", body })).status,
        401,
      );
    const app = createApp({
      db: f.db,
      origin: "http://127.0.0.1:5173",
      rateLimits: { auth: 50, login: 2 },
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/auth/login`,
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:5173",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, email: "member@dryad.test" }),
      },
    );
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    for (const row of f.db.prepare("SELECT * FROM request_limits").all())
      assert.match(row.key, /^[a-f0-9]{64}$/);
    f.db.prepare("UPDATE request_limits SET reset_at=0").run();
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await f.request("/auth/login", {
            method: "POST",
            body: {
              email: "member@dryad.test",
              password: "Dryad local test password",
            },
          })
        ).status,
        200,
      );
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await f.close();
  }
});

test("download and email limits return 429 with retry timing while account metadata remains usable", async () => {
  const f = await fixture({
    rateLimits: { downloadAccount: 2, emailAccount: 2 },
  });
  try {
    const a = await f.register();
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await f.request("/account/release/download", { cookie: a.cookie }))
          .status,
        403,
      );
    const blocked = await f.request("/account/release/download", {
      cookie: a.cookie,
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.data.retryAfter > 0);
    assert.equal(
      (await f.request("/account/release", { cookie: a.cookie })).status,
      200,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await f.request("/auth/forgot", {
            method: "POST",
            body: { email: "unknown@dryad.test" },
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await f.request("/auth/forgot", {
          method: "POST",
          body: { email: "UNKNOWN@DRYAD.TEST" },
        })
      ).status,
      429,
    );
  } finally {
    await f.close();
  }
});

test("membership navigation status reflects current expiry, billing holds and cancellation at period end", async () => {
  const f = await fixture();
  try {
    const a = await f.register(),
      user = a.data.user,
      cookie = a.cookie;
    const status = async () =>
      (await f.request("/auth/me", { cookie })).data.user.membershipActive;
    assert.equal(await status(), false);
    f.db
      .prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,1)")
      .run(
        user.id,
        "sub_nav",
        "active",
        "monthly",
        Math.floor(Date.now() / 1000) + 3600,
      );
    assert.equal(await status(), true);
    f.db
      .prepare("INSERT INTO billing_holds VALUES(?,?,?)")
      .run("hold", user.id, "Dispute");
    assert.equal(await status(), false);
    f.db.prepare("DELETE FROM billing_holds").run();
    f.db.prepare("UPDATE subscriptions SET period_end=1").run();
    assert.equal(await status(), false);
  } finally {
    await f.close();
  }
});
