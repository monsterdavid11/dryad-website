import { randomUUID, randomBytes } from "node:crypto";
import { statSync, createReadStream } from "node:fs";
import { digest, secret, failure, installationKey, proof } from "./security.js";

export function installNative(
  app,
  {
    db,
    signing,
    origin,
    production,
    allowDevLicenses = false,
    requireVerified = true,
    resetDays = 5,
    deviceLimit = 1,
    requireUser,
  },
) {
  if (production && allowDevLicenses)
    throw Error("Development licenses are forbidden in production.");
  const now = () => Math.floor(Date.now() / 1000),
    get = (sql, ...args) => db.prepare(sql).get(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args);
  const audit = (user, action, details = {}) =>
    run(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      user,
      action,
      Date.now(),
      JSON.stringify(details),
    );
  function entitlement(id) {
    if (get("SELECT id FROM billing_holds WHERE user_id=?", id))
      throw failure(
        403,
        "Membership access is suspended pending billing resolution.",
      );
    const sub = get("SELECT * FROM subscriptions WHERE user_id=?", id);
    if (
      sub &&
      ["active", "trialing"].includes(sub.status) &&
      sub.period_end > now()
    )
      return { sub: sub.stripe_id, until: sub.period_end, development: false };
    const dev =
      allowDevLicenses &&
      get(
        "SELECT * FROM dev_entitlements WHERE user_id=? AND expires>?",
        id,
        now(),
      );
    if (dev)
      return {
        sub: "local-development",
        until: dev.expires,
        development: true,
      };
    throw failure(403, "An active Dryad membership is required.");
  }
  function allowedUser(user) {
    if (user.demo) throw failure(403, "Demo accounts cannot pair a device.");
    if (
      requireVerified &&
      !get("SELECT user_id FROM verified_emails WHERE user_id=?", user.id)
    )
      throw failure(403, "Verify your email before connecting a device.");
    return entitlement(user.id);
  }
  function device(id) {
    const d = get(
      "SELECT d.*,k.public_key,k.revoked_at FROM devices d JOIN device_keys k ON k.device_id=d.id WHERE d.id=?",
      id,
    );
    if (!d || d.revoked_at)
      throw failure(401, "Device has been revoked. Sign in again.");
    return d;
  }
  function issue(d) {
    if (!signing) throw failure(503, "License signing is not configured.");
    const access = entitlement(d.user_id);
    const token = secret();
    run(
      "INSERT INTO native_tokens VALUES(?,?,?,0)",
      digest(token),
      d.id,
      now() + 30 * 86400,
    );
    const lease = signing.sign({
      iss: "dryad",
      aud: "dryad-overlay",
      sub: d.user_id,
      device: d.id,
      product: "dryad",
      iat: now(),
      exp: Math.min(now() + 600, access.until),
      jti: randomUUID(),
      development: access.development,
    });
    run(
      "UPDATE devices SET last_seen=? WHERE id=?",
      new Date().toISOString(),
      d.id,
    );
    return {
      deviceId: d.id,
      refreshToken: token,
      lease,
      expiresIn: 600,
      refreshAfter: 300,
      development: access.development,
    };
  }
  function verifyRequest(req, purpose) {
    const { deviceId, challengeId, signature, payload } = req.body;
    if (typeof payload !== "string" || payload.length > 14000)
      throw failure(400, "Invalid native payload.");
    const d = device(deviceId),
      challenge = get(
        "SELECT * FROM native_challenges WHERE id=? AND device_id=? AND purpose=? AND expires>?",
        challengeId,
        deviceId,
        purpose,
        now(),
      );
    if (
      !challenge ||
      !proof(
        installationKey(d.public_key),
        `dryad:v1\n${purpose}\n${challengeId}\n${challenge.nonce}\n${digest(payload)}`,
        signature,
      )
    )
      throw failure(401, "Invalid or expired installation proof.");
    let body;
    try {
      body = JSON.parse(payload);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw Error();
    } catch {
      throw failure(400, "Invalid native JSON.");
    }
    const consumed = run(
      "DELETE FROM native_challenges WHERE id=?",
      challengeId,
    );
    if (!consumed.changes)
      throw failure(401, "Installation proof was already used.");
    return { d, body };
  }
  function authenticate(req, purpose) {
    const { d, body } = verifyRequest(req, purpose);
    if (typeof body.refreshToken !== "string")
      throw failure(401, "Native authentication required.");
    const t = get(
      "SELECT * FROM native_tokens WHERE hash=? AND device_id=? AND used=0 AND expires>?",
      digest(body.refreshToken),
      d.id,
      now(),
    );
    if (!t) throw failure(401, "Native session is no longer active.");
    entitlement(d.user_id);
    return { d, body, t };
  }
  app.post("/api/native/pair/start", (req, res) => {
    const { publicKey, name } = req.body;
    if (
      typeof publicKey !== "string" ||
      publicKey.length > 1024 ||
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 80
    )
      throw failure(400, "Provide an installation key and device name.");
    installationKey(publicKey);
    if (!signing) throw failure(503, "License signing is not configured.");
    run("DELETE FROM pairings WHERE expires<?", now());
    const code = secret(),
      userCode = randomBytes(4).toString("hex").toUpperCase(),
      id = randomUUID();
    run(
      "INSERT INTO pairings(id,code_hash,user_code,public_key,name,expires) VALUES(?,?,?,?,?,?)",
      id,
      digest(code),
      userCode,
      publicKey,
      name,
      now() + 300,
    );
    res.json({
      deviceCode: code,
      userCode,
      verificationUrl: `${origin}/connect?code=${userCode}`,
      expiresIn: 300,
      interval: 5,
    });
  });
  app.get("/api/account/pairing/:code", requireUser, (req, res) => {
    const p = get(
      "SELECT name,expires,user_code FROM pairings WHERE user_code=? AND claimed=0 AND expires>? AND user_id IS NULL",
      String(req.params.code).toUpperCase(),
      now(),
    );
    if (!p)
      throw failure(404, "Pairing request expired or was already approved.");
    res.json({ name: p.name, expires: p.expires, code: p.user_code });
  });
  app.post("/api/account/pairing/approve", requireUser, (req, res) => {
    allowedUser(req.user);
    const p = get(
      "SELECT * FROM pairings WHERE user_code=? AND expires>? AND user_id IS NULL",
      req.body.code,
      now(),
    );
    if (!p)
      throw failure(404, "Pairing request expired or was already approved.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = get(
        "SELECT d.id FROM devices d JOIN device_keys k ON k.device_id=d.id WHERE d.user_id=? AND k.public_key=?",
        req.user.id,
        p.public_key,
      );
      const count = get(
        "SELECT count(*) AS n FROM device_keys k JOIN devices d ON d.id=k.device_id WHERE d.user_id=? AND k.revoked_at IS NULL",
        req.user.id,
      ).n;
      if (!existing && count >= deviceLimit)
        throw failure(
          409,
          "Your one-device allowance is in use. Remove the old device first.",
        );
      const id = existing?.id || randomUUID();
      if (!existing) {
        run(
          "INSERT INTO devices VALUES(?,?,?,?)",
          id,
          req.user.id,
          p.name,
          new Date().toISOString(),
        );
        run("INSERT INTO device_keys VALUES(?,?,NULL)", id, p.public_key);
      } else {
        run("UPDATE device_keys SET revoked_at=NULL WHERE device_id=?", id);
        run("DELETE FROM native_tokens WHERE device_id=?", id);
      }
      run(
        "UPDATE pairings SET user_id=?,device_id=? WHERE id=?",
        req.user.id,
        id,
        p.id,
      );
      audit(req.user.id, "device_paired", { device: id });
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/native/pair/poll", (req, res) => {
    if (typeof req.body.deviceCode !== "string")
      throw failure(400, "Device code is required.");
    const p = get(
      "SELECT * FROM pairings WHERE code_hash=? AND expires>? AND claimed=0",
      digest(req.body.deviceCode),
      now(),
    );
    if (!p) throw failure(401, "Pairing expired or was already claimed.");
    if (
      !proof(
        installationKey(p.public_key),
        `dryad:pair\n${req.body.deviceCode}`,
        req.body.signature,
      )
    )
      throw failure(401, "Invalid installation signature.");
    if (!p.user_id) return res.status(202).json({ pending: true });
    db.exec("BEGIN IMMEDIATE");
    try {
      run("UPDATE pairings SET claimed=1 WHERE id=?", p.id);
      const result = issue(device(p.device_id));
      db.exec("COMMIT");
      res.json(result);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/native/challenge", (req, res) => {
    if (!["refresh", "telemetry", "manifest"].includes(req.body.purpose))
      throw failure(400, "Unknown challenge purpose.");
    const d = device(req.body.deviceId);
    run("DELETE FROM native_challenges WHERE expires<?", now());
    const id = randomUUID(),
      nonce = secret();
    run(
      "INSERT INTO native_challenges VALUES(?,?,?,?,?)",
      id,
      d.id,
      nonce,
      req.body.purpose,
      now() + 60,
    );
    res.json({ id, nonce, expiresIn: 60 });
  });
  app.post("/api/native/refresh", (req, res) => {
    const { d, body } = verifyRequest(req, "refresh");
    if (typeof body.refreshToken !== "string")
      throw failure(401, "Refresh credential required.");
    const token = get(
      "SELECT * FROM native_tokens WHERE hash=? AND device_id=?",
      digest(body.refreshToken),
      d.id,
    );
    if (!token || token.expires <= now())
      throw failure(401, "Native session expired.");
    if (token.used) {
      run("UPDATE device_keys SET revoked_at=? WHERE device_id=?", now(), d.id);
      run("DELETE FROM native_tokens WHERE device_id=?", d.id);
      audit(d.user_id, "refresh_reuse_revoked", { device: d.id });
      throw failure(401, "Refresh credential reuse detected. Device revoked.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      run("UPDATE native_tokens SET used=1 WHERE hash=?", token.hash);
      const result = issue(d);
      db.exec("COMMIT");
      res.json(result);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/native/telemetry", (req, res) => {
    const { d, body } = authenticate(req, "telemetry"),
      e = body.event;
    const fields = ["seconds", "runs", "gold", "elixir", "walls"];
    if (
      !e ||
      !/^[-a-zA-Z0-9]{1,80}$/.test(e.sessionId || "") ||
      !["Farming loop", "Wall upgrades", "Hero management"].includes(
        e.script,
      ) ||
      !Number.isSafeInteger(e.sequence) ||
      e.sequence < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.day || "") ||
      !Number.isFinite(Date.parse(e.day)) ||
      new Date(e.day).toISOString().slice(0, 10) !== e.day ||
      fields.some((k) => !Number.isSafeInteger(e[k]) || e[k] < 0) ||
      e.seconds > 86400 ||
      e.runs > 10000 ||
      e.walls > 10000 ||
      e.gold > 1e11 ||
      e.elixir > 1e11 ||
      Math.abs(Date.parse(e.day) - Date.now()) > 31 * 86400000
    )
      throw failure(400, "Invalid or out-of-range usage snapshot.");
    const old = get(
      "SELECT * FROM telemetry_sessions WHERE device_id=? AND session_id=? AND day=?",
      d.id,
      e.sessionId,
      e.day,
    );
    if (old && e.sequence <= old.sequence)
      return res.json({ ok: true, duplicate: true });
    if (old && fields.some((k) => e[k] < old[k]))
      throw failure(
        409,
        "Usage counters must be monotonic within a session/day.",
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      run(
        "INSERT INTO telemetry VALUES(?,?,?,?,?)",
        d.id,
        e.sessionId,
        e.sequence,
        Date.now(),
        JSON.stringify(e),
      );
      run(
        "INSERT INTO telemetry_sessions VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id,session_id,day) DO UPDATE SET sequence=excluded.sequence,seconds=excluded.seconds,runs=excluded.runs,gold=excluded.gold,elixir=excluded.elixir,walls=excluded.walls",
        d.id,
        e.sessionId,
        e.sequence,
        e.day,
        e.script,
        e.seconds,
        e.runs,
        e.gold,
        e.elixir,
        e.walls,
      );
      const id = `native:${d.id}:${e.sessionId}:${e.day}`;
      run(
        "INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seconds=excluded.seconds,runs=excluded.runs,gold=excluded.gold,elixir=excluded.elixir,walls=excluded.walls",
        id,
        d.user_id,
        e.script,
        `${e.day}T12:00:00.000Z`,
        e.seconds,
        e.runs,
        e.gold,
        e.elixir,
        e.walls,
      );
      run(
        "UPDATE devices SET last_seen=? WHERE id=?",
        new Date().toISOString(),
        d.id,
      );
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  });
  app.post("/api/native/manifest", (req, res) => {
    const { d, body } = authenticate(req, "manifest");
    const channel = body.channel || "stable";
    if (!["stable", "preview"].includes(channel))
      throw failure(400, "Unknown release channel.");
    const r = get(
      "SELECT * FROM release_catalog WHERE channel=? AND enabled=1",
      channel,
    );
    if (!r) throw failure(404, "No release is published in this channel.");
    if (!signing) throw failure(503, "Release signing is unavailable.");
    const token = secret();
    run(
      "INSERT INTO download_tokens VALUES(?,?,?,?,?)",
      digest(token),
      d.id,
      channel,
      r.sha256,
      now() + 60,
    );
    res.json({
      manifest: signing.sign({
        iss: "dryad",
        aud: "dryad-release",
        iat: now(),
        exp: now() + 60,
        channel,
        version: r.version,
        sha256: r.sha256,
        bytes: r.bytes,
        url: `${origin}/api/native/download/${token}`,
      }),
    });
  });
  app.get("/api/native/download/:token", (req, res) => {
    const t = get(
      "SELECT * FROM download_tokens WHERE hash=? AND expires>?",
      digest(req.params.token),
      now(),
    );
    if (!t) throw failure(401, "Download link expired.");
    const d = device(t.device_id);
    entitlement(d.user_id);
    const r = get(
      "SELECT * FROM release_catalog WHERE channel=? AND enabled=1 AND sha256=?",
      t.channel,
      t.sha256,
    );
    if (!r || statSync(r.path).size !== r.bytes)
      throw failure(404, "Release is no longer available.");
    run("DELETE FROM download_tokens WHERE hash=?", t.hash);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="Dryad.dll"');
    createReadStream(r.path)
      .on("error", () => res.destroy())
      .pipe(res);
  });
  return { entitlement, audit };
}
