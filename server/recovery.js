import { randomUUID } from "node:crypto";
import { digest, secret, failure } from "./security.js";
import { recoveryEmail } from "./email-templates.js";
export function installRecovery(
  app,
  { db, origin, requireUser, authLimit, passwordHash, queue },
) {
  const get = (sql, ...args) => db.prepare(sql).get(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args),
    now = () => Math.floor(Date.now() / 1000);
  function requestToken(user, purpose) {
    const token = secret();
    const expires = now() + (purpose === "verify" ? 86400 : 1200);
    run(
      "DELETE FROM recovery_tokens WHERE user_id=? AND purpose=?",
      user.id,
      purpose,
    );
    run(
      "INSERT INTO recovery_tokens VALUES(?,?,?,?)",
      digest(token),
      user.id,
      purpose,
      expires,
    );
    queue.enqueue(
      "email",
      recoveryEmail({
        origin,
        token,
        purpose,
        to: user.email,
        expiresAt: expires * 1000,
      }),
    );
  }
  app.get("/api/account/security", requireUser, (req, res) =>
    res.json({
      emailVerified: Boolean(
        get("SELECT user_id FROM verified_emails WHERE user_id=?", req.user.id),
      ),
    }),
  );
  app.post("/api/account/verify-email", requireUser, authLimit, (req, res) => {
    if (req.user.demo) throw failure(403, "Create your own account first.");
    requestToken(req.user, "verify");
    res.json({
      ok: true,
      message: "Verification email queued. Check your inbox.",
    });
  });
  app.post("/api/auth/forgot", authLimit, (req, res) => {
    if (typeof req.body.email !== "string" || req.body.email.length > 254)
      throw failure(400, "Enter a valid email.");
    const u = get(
      "SELECT * FROM users WHERE email=? AND demo=0",
      req.body.email.trim().toLowerCase(),
    );
    if (u) requestToken(u, "reset");
    res.json({
      ok: true,
      message:
        "If this email belongs to an account, recovery instructions have been queued.",
    });
  });
  app.post("/api/auth/recover", authLimit, async (req, res) => {
    if (typeof req.body.token !== "string" || req.body.token.length > 128)
      throw failure(400, "Invalid recovery token.");
    const t = get(
      "SELECT * FROM recovery_tokens WHERE hash=? AND expires>?",
      digest(req.body.token),
      now(),
    );
    if (!t) throw failure(400, "Link expired or already used.");
    if (t.purpose === "verify") {
      db.exec("BEGIN IMMEDIATE");
      try {
        run("DELETE FROM recovery_tokens WHERE hash=?", t.hash);
        run(
          "INSERT OR IGNORE INTO verified_emails VALUES(?,?)",
          t.user_id,
          now(),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return res.json({
        ok: true,
        message: "Email verified. You can connect your Dryad launcher.",
      });
    }
    const p = req.body.password;
    if (typeof p !== "string" || p.length < 12 || p.length > 128)
      throw failure(400, "Password must have 12–128 characters.");
    const encoded = await passwordHash(p);
    db.exec("BEGIN IMMEDIATE");
    try {
      // Recheck after asynchronous password hashing so concurrent requests cannot reuse a token.
      if (
        !get(
          "SELECT hash FROM recovery_tokens WHERE hash=? AND expires>?",
          t.hash,
          now(),
        )
      )
        throw failure(400, "Link expired or already used.");
      run("UPDATE users SET password=? WHERE id=?", encoded, t.user_id);
      run("DELETE FROM recovery_tokens WHERE user_id=?", t.user_id);
      run("DELETE FROM sessions WHERE user_id=?", t.user_id);
      run(
        "DELETE FROM native_tokens WHERE device_id IN (SELECT id FROM devices WHERE user_id=?)",
        t.user_id,
      );
      db.exec("COMMIT");
      res.json({
        ok: true,
        message:
          "Password reset. Browser and launcher sessions were signed out.",
      });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.get("/api/account/export", requireUser, (req, res) => {
    const rows = (sql) => db.prepare(sql).all(req.user.id);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="dryad-account.json"',
    );
    res.json({
      profile: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        createdAt: req.user.created_at,
      },
      devices: rows("SELECT id,name,last_seen FROM devices WHERE user_id=?"),
      usage: rows(
        "SELECT script,started_at,seconds,runs,gold,elixir,walls FROM usage WHERE user_id=?",
      ),
      subscription:
        get(
          "SELECT status,plan,period_end,cancel_at_end FROM subscriptions WHERE user_id=?",
          req.user.id,
        ) || null,
      audit: rows("SELECT action,at,details FROM audit WHERE user_id=?"),
    });
  });
}
