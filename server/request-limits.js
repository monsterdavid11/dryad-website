import { createHash } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";

// Fixed windows persisted in the single-instance SQLite database. Only hashed
// identifiers are stored; no raw IP addresses or login emails enter this table.
export function requestLimits(db, overrides = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(reset_at);`);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const ip = (req) => ipKeyGenerator(req.ip || "unknown");
  function limiter(
    scope,
    maximum,
    windowMs,
    identify = ip,
    skipSuccessful = false,
  ) {
    const limit = overrides[scope] ?? maximum;
    return (req, res, next) => {
      const now = Date.now(),
        key = hash(scope + ":" + identify(req));
      db.prepare("DELETE FROM request_limits WHERE reset_at<=?").run(now);
      const row = db
        .prepare(
          `INSERT INTO request_limits VALUES(?,1,?)
        ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits,reset_at`,
        )
        .get(key, now + windowMs);
      const retry = Math.max(1, Math.ceil((row.reset_at - now) / 1000));
      res.setHeader(
        "RateLimit",
        `limit=${limit}, remaining=${Math.max(0, limit - row.hits)}, reset=${retry}`,
      );
      res.setHeader(
        "RateLimit-Policy",
        `${limit};w=${Math.ceil(windowMs / 1000)}`,
      );
      if (row.hits > limit) {
        res.setHeader("Retry-After", retry);
        return res
          .status(429)
          .json({
            error: "Too many requests. Please wait before trying again.",
            retryAfter: retry,
          });
      }
      if (skipSuccessful)
        res.once("finish", () => {
          if (res.statusCode < 400)
            db.prepare(
              "UPDATE request_limits SET hits=MAX(0,hits-1) WHERE key=? AND reset_at=?",
            ).run(key, row.reset_at);
        });
      next();
    };
  }
  const account = (req) => req.user?.id || ip(req);
  const email = (req) =>
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase().slice(0, 254)
      : ip(req);
  return {
    api: limiter("api", 150, 60_000),
    auth: limiter("auth", 20, 15 * 60_000),
    login: limiter("login", 10, 15 * 60_000, email, true),
    emailIp: limiter("emailIp", 5, 60 * 60_000),
    emailAccount: limiter(
      "emailAccount",
      3,
      60 * 60_000,
      (req) => req.user?.id || email(req),
    ),
    billing: limiter("billing", 10, 15 * 60_000, account),
    downloadIp: limiter("downloadIp", 20, 15 * 60_000),
    downloadAccount: limiter(
      "downloadAccount",
      5,
      15 * 60_000,
      (req) => req.downloadUserId || account(req),
    ),
    export: limiter("export", 3, 60 * 60_000, account),
    pairing: limiter("pairing", 10, 15 * 60_000),
  };
}
