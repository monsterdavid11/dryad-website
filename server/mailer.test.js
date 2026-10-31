import test from "node:test";
import assert from "node:assert/strict";
import { mailer } from "./mailer.js";
import { recoveryEmail } from "./email-templates.js";
import { openDatabase } from "./db.js";
import { jobQueue } from "./jobs.js";

const env = {
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "test-placeholder",
  EMAIL_FROM: "Dryad <accounts@dryadclient.dev>",
};
const message = (purpose = "verify", token = "test-token") =>
  recoveryEmail({
    origin: "https://dryadclient.dev",
    token,
    purpose,
    to: "member@example.com",
    expiresAt: Date.now() + 1200000,
  });

test("account emails preserve the one-use HTTPS link in HTML and text, with accurate expiry and escaping", () => {
  for (const purpose of ["verify", "reset"]) {
    const email = message(purpose, 'token"<&');
    const url = new URL(email.text.match(/https:\/\/\S+/)[0]);
    assert.equal(url.origin, "https://dryadclient.dev");
    assert.equal(url.pathname, "/recover");
    assert.equal(url.searchParams.get("purpose"), purpose);
    assert.equal(url.searchParams.get("token"), 'token"<&');
    assert.match(email.html, /purpose=(verify|reset)&amp;token=/);
    assert.ok(
      email.html.includes(purpose === "verify" ? "24 hours" : "20 minutes"),
    );
    assert.ok(!email.html.includes('token"<&'));
  }
});

test("email queue retries retain Resend idempotency, erase delivered payloads and do not expose provider error bodies", async () => {
  const calls = [],
    db = openDatabase(":memory:");
  try {
    const send = mailer({
      production: true,
      env,
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        return calls.length === 1
          ? new Response("private recipient/token details must not be logged", {
              status: 503,
            })
          : Response.json({ id: "provider-message" });
      },
    });
    const queue = jobQueue(db, { email: send });
    queue.enqueue("email", message(), "email-retry");
    await queue.tick();
    assert.equal(
      db.prepare("SELECT error FROM jobs").get().error,
      "EMAIL_HTTP_503",
    );
    db.prepare("UPDATE jobs SET available=0").run();
    await queue.tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(
      calls[0].headers["Idempotency-Key"],
      calls[1].headers["Idempotency-Key"],
    );
    assert.equal(calls[0].body, calls[1].body);
    const payload = JSON.parse(calls[0].body);
    assert.equal(payload.from, env.EMAIL_FROM);
    assert.equal(payload.expiresAt, undefined);
    assert.ok(payload.html && payload.text);
    const result = db.prepare("SELECT state,payload FROM jobs").get();
    assert.equal(result.state, "done");
    assert.equal(result.payload, "{}");
    await send(message("reset", "another-token"));
    assert.notEqual(
      calls[1].headers["Idempotency-Key"],
      calls[2].headers["Idempotency-Key"],
    );
  } finally {
    db.close();
  }
});

test("email sending fails closed without credentials; expired jobs never contact the provider", async () => {
  let requests = 0;
  const send = mailer({
    production: true,
    env,
    fetchImpl: async () => {
      requests++;
      throw Error("unreachable");
    },
  });
  assert.deepEqual(await send({ ...message(), expiresAt: Date.now() - 1 }), {
    skipped: "expired",
  });
  assert.equal(requests, 0);
  await assert.rejects(send(message()), { code: "EMAIL_NETWORK" });
  await assert.rejects(
    mailer({ production: true, env: {} })(message()),
    /not configured/,
  );
  await assert.rejects(
    mailer({ production: true, env: { EMAIL_PROVIDER: "resend" } })(message()),
    /required/,
  );
  assert.throws(
    () => mailer({ production: true, env: { EMAIL_PROVIDER: "spool" } }),
    /forbidden/,
  );
  await assert.rejects(
    mailer({ production: true, env, fetchImpl: async () => Response.json({}) })(
      message(),
    ),
    /acknowledge/,
  );
});
