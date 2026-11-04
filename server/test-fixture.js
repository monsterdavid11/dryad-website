import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { signer, digest } from "./security.js";
const origin = "http://127.0.0.1:5173";
export async function fixture({ signing: customSigning, ...options } = {}) {
  const db = openDatabase(":memory:"),
    { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    signing =
      customSigning ||
      signer(privateKey.export({ type: "pkcs8", format: "pem" }));
  const app = createApp({
    db,
    signing,
    origin,
    allowDevLicenses: true,
    ...options,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(
    path,
    { method = "GET", body, cookie, native = false } = {},
  ) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(!native ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: r.status,
      data,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function register(email = "member@dryad.test") {
    const r = await request("/auth/register", {
      method: "POST",
      body: {
        name: "Dryad Tester",
        email,
        password: "Dryad local test password",
      },
    });
    assert.equal(r.status, 201);
    return r;
  }
  function grant(user) {
    db.prepare("INSERT OR REPLACE INTO dev_entitlements VALUES(?,?)").run(
      user.id,
      Math.floor(Date.now() / 1000) + 86400,
    );
    db.prepare("INSERT OR IGNORE INTO verified_emails VALUES(?,?)").run(
      user.id,
      Math.floor(Date.now() / 1000),
    );
  }
  function identity() {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return {
      ...keys,
      hardware: digest(randomUUID()),
      encoded: keys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
  }
  const sig = (key, msg) =>
    sign("sha256", Buffer.from(msg), {
      key: key.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
  async function start(key) {
    return request("/native/pair/start", {
      method: "POST",
      native: true,
      body: {
        name: "Dryad test PC",
        publicKey: key.encoded,
        hardware: key.hardware,
      },
    });
  }
  async function pair(key, account) {
    const p = await start(key);
    assert.equal(p.status, 200);
    const a = await request("/account/pairing/approve", {
      method: "POST",
      cookie: account.cookie,
      body: { code: p.data.userCode },
    });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    const r = await request("/native/pair/poll", {
      method: "POST",
      native: true,
      body: {
        deviceCode: p.data.deviceCode,
        signature: sig(key, `dryad:pair\n${p.data.deviceCode}`),
      },
    });
    assert.equal(r.status, 200);
    return r.data;
  }
  async function native(key, auth, purpose, body) {
    const ch = await request("/native/challenge", {
      method: "POST",
      native: true,
      body: { deviceId: auth.deviceId, purpose },
    });
    if (ch.status !== 200) return ch;
    const payload = JSON.stringify({ hardware: key.hardware, ...body }),
      envelope = {
        deviceId: auth.deviceId,
        challengeId: ch.data.id,
        payload,
        signature: sig(
          key,
          `dryad:v1\n${purpose}\n${ch.data.id}\n${ch.data.nonce}\n${digest(payload)}`,
        ),
      };
    return request("/native/" + purpose, {
      method: "POST",
      native: true,
      body: envelope,
    });
  }
  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
  return {
    db,
    app,
    base,
    signing,
    request,
    register,
    grant,
    identity,
    sig,
    start,
    pair,
    native,
    close,
  };
}
