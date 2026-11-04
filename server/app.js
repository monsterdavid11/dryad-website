import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { requestLimits } from "./request-limits.js";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const scrypt = promisify(scryptCallback);
const hash = (value) => createHash("sha256").update(value).digest("hex");
import { plans, policy } from "./plans.js";
import { applyStripeEvent } from "./billing.js";
import { jobQueue } from "./jobs.js";
import { installNative } from "./native.js";
import { installRecovery } from "./recovery.js";
import { mailer } from "./mailer.js";
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}
async function matches(password, stored) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    await scrypt(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
const safeUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  createdAt: u.created_at,
  demo: Boolean(u.demo),
});
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createApp({
  db,
  stripe = null,
  billingMode = "test",
  webhookSecret = "",
  priceIds = {},
  origin = "http://127.0.0.1:5173",
  production = false,
  demoMode = !production,
  signing = null,
  allowDevLicenses = false,
  requireVerified = true,
  durableWebhooks = false,
  emailSender = null,
  trustProxyHops = 0,
  portalConfiguration = "",
  rateLimits = {},
}) {
  if (production && demoMode)
    throw new Error("DEMO_MODE must be false in production");
  if (!["test", "live"].includes(billingMode))
    throw new Error("Invalid billing mode.");
  const app = express();
  const limits = requestLimits(db, rateLimits);
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  const checkoutLocks = new Set();
  const queue = jobQueue(db, {
    stripe: (event) => applyStripeEvent({ db, stripe, priceIds }, event),
    email: emailSender || mailer({ production }),
  });
  app.locals.queue = queue;
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "media-src": ["'self'", "blob:"],
        },
      },
    }),
  );
  const query = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  // Stripe requires the unparsed body. No cookie/CSRF credentials are used here.
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res, next) => {
      try {
        if (!stripe || !webhookSecret)
          throw fail(503, "Stripe webhooks are not configured.");
        let event;
        try {
          event = stripe.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            webhookSecret,
          );
          if (Boolean(event.livemode) !== (billingMode === "live"))
            throw new Error("Webhook mode does not match.");
        } catch {
          throw fail(400, "Invalid webhook signature.");
        }
        if (durableWebhooks)
          queue.enqueue("stripe", event, "stripe:" + event.id);
        else await applyStripeEvent({ db, stripe, priceIds }, event);
        res.json({ received: true, queued: durableWebhooks });
      } catch (e) {
        next(e);
      }
    },
  );
  app.use(express.json({ limit: "16kb" }), cookieParser());
  app.use((req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      req.body = {};
    next();
  });
  app.use("/api", limits.api);
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.path.startsWith("/native/") &&
      req.headers.origin !== origin
    )
      return next(fail(403, "Request origin is not allowed."));
    const token = req.cookies.dryad_session;
    if (token)
      req.user = query(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?",
        hash(token),
        Date.now(),
      );
    next();
  });
  const requireUser = (req, res, next) =>
    req.user ? next() : next(fail(401, "Please sign in to continue."));
  const authLimit = limits.auth;
  const hasMembership = (id) => {
    const sub = query(
      "SELECT status,period_end FROM subscriptions WHERE user_id=?",
      id,
    );
    return Boolean(
      sub &&
      ["active", "trialing"].includes(sub.status) &&
      sub.period_end > Date.now() / 1000 &&
      !query("SELECT id FROM billing_holds WHERE user_id=?", id),
    );
  };
  const session = (res, user) => {
    const token = randomBytes(32).toString("hex");
    run("DELETE FROM sessions WHERE expires<=?", Date.now());
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      user.id,
      Date.now() + 7 * 86400_000,
    );
    res.cookie("dryad_session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      maxAge: 7 * 86400_000,
      path: "/",
    });
  };
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/config", (req, res) =>
    res.json({
      demoMode,
      billingReady: Boolean(
        stripe && webhookSecret && priceIds.monthly && priceIds.yearly,
      ),
      billingMode: stripe ? billingMode : "disabled",
      plans,
      policy,
      allowDevLicenses,
    }),
  );
  app.get("/api/auth/me", (req, res) =>
    res.json({
      user: req.user
        ? {
            ...safeUser(req.user),
            membershipActive: !req.user.demo && hasMembership(req.user.id),
          }
        : null,
    }),
  );
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const { name, email, password } = req.body;
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.length > 60 ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      throw fail(
        400,
        "Enter a name, valid email, and a password of 12–128 characters.",
      );
    const normalized = email.trim().toLowerCase();
    const encoded = await passwordHash(password);
    if (query("SELECT id FROM users WHERE email=?", normalized))
      throw fail(409, "An account with this email already exists.");
    const id = randomUUID();
    run(
      "INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)",
      id,
      normalized,
      name.trim(),
      encoded,
      new Date().toISOString(),
    );
    const user = query("SELECT * FROM users WHERE id=?", id);
    session(res, user);
    res.status(201).json({ user: safeUser(user) });
  });
  app.post("/api/auth/login", authLimit, limits.login, async (req, res) => {
    const { email, password } = req.body;
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 128
    )
      throw fail(400, "Enter your email and password.");
    const user = query(
      "SELECT * FROM users WHERE email=? AND demo=0",
      email.trim().toLowerCase(),
    );
    // Always do password work, including unknown accounts.
    const valid = await matches(
      password,
      user?.password || "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!user || !valid) throw fail(401, "Email or password is incorrect.");
    session(res, user);
    res.json({
      user: { ...safeUser(user), membershipActive: hasMembership(user.id) },
    });
  });
  app.post("/api/auth/demo", authLimit, async (req, res) => {
    if (!demoMode || production) throw fail(404, "Demo mode is unavailable.");
    let user = query("SELECT * FROM users WHERE demo=1");
    if (!user) {
      const id = randomUUID();
      const encoded = await passwordHash(randomBytes(32).toString("hex"));
      db.exec("BEGIN");
      try {
        run(
          "INSERT INTO users(id,email,name,password,created_at,demo) VALUES(?,?,?,?,?,1)",
          id,
          "explorer@playoverlay.local",
          "Alex Morgan",
          encoded,
          new Date().toISOString(),
        );
        run(
          "INSERT INTO devices VALUES(?,?,?,?)",
          randomUUID(),
          id,
          "DESKTOP-ALEX · Windows 11",
          new Date().toISOString(),
        );
        for (let i = 0; i < 14; i++)
          run(
            "INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)",
            randomUUID(),
            id,
            ["Farming loop", "Wall upgrades", "Hero management"][i % 3],
            new Date(Date.now() - i * 86400_000 - 3600000).toISOString(),
            2400 + ((i * 937) % 12000),
            8 + i * 3,
            2350000 + i * 350000,
            1900000 + i * 220000,
            i % 3 === 1 ? 12 + i : 0,
          );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      user = query("SELECT * FROM users WHERE id=?", id);
    }
    session(res, user);
    res.json({ user: safeUser(user) });
  });
  app.post("/api/auth/logout", (req, res) => {
    if (req.cookies.dryad_session)
      run(
        "DELETE FROM sessions WHERE token_hash=?",
        hash(req.cookies.dryad_session),
      );
    res.clearCookie("dryad_session", {
      path: "/",
      httpOnly: true,
      secure: production,
      sameSite: "lax",
    });
    res.json({ ok: true });
  });
  app.get("/api/account", requireUser, (req, res) => {
    const usage = db
      .prepare(
        "SELECT MIN(id) AS id,script,substr(started_at,1,10)||'T12:00:00.000Z' AS started_at,SUM(seconds) AS seconds,SUM(runs) AS runs,SUM(gold) AS gold,SUM(elixir) AS elixir,SUM(walls) AS walls FROM usage WHERE user_id=? GROUP BY script,substr(started_at,1,10) ORDER BY started_at DESC LIMIT 365",
      )
      .all(req.user.id);
    res.json({
      user: {
        ...safeUser(req.user),
        membershipActive: !req.user.demo && hasMembership(req.user.id),
      },
      billingHold: Boolean(
        query("SELECT id FROM billing_holds WHERE user_id=?", req.user.id),
      ),
      deviceResetAvailableAt:
        (query(
          "SELECT reset_at FROM device_resets WHERE user_id=?",
          req.user.id,
        )?.reset_at || 0) +
        policy.resetDays * 86400,
      subscription:
        query(
          "SELECT status,plan,period_end,cancel_at_end FROM subscriptions WHERE user_id=?",
          req.user.id,
        ) || null,
      devices: db
        .prepare("SELECT id,name,last_seen FROM devices WHERE user_id=?")
        .all(req.user.id),
      usage,
    });
  });
  app.patch("/api/account", requireUser, (req, res) => {
    if (req.user.demo)
      throw fail(
        403,
        "Demo profiles are read-only. Create your own account to edit.",
      );
    const name = req.body.name;
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 60)
      throw fail(400, "Your name must have 2–60 characters.");
    run("UPDATE users SET name=? WHERE id=?", name.trim(), req.user.id);
    res.json({
      user: {
        ...safeUser(query("SELECT * FROM users WHERE id=?", req.user.id)),
        membershipActive: hasMembership(req.user.id),
      },
    });
  });
  app.post(
    "/api/account/password",
    requireUser,
    authLimit,
    async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      if (req.user.demo) throw fail(403, "Demo profiles are read-only.");
      if (
        typeof currentPassword !== "string" ||
        currentPassword.length > 128 ||
        typeof newPassword !== "string" ||
        newPassword.length < 12 ||
        newPassword.length > 128
      )
        throw fail(400, "New password must have 12–128 characters.");
      if (!(await matches(currentPassword, req.user.password)))
        throw fail(400, "Current password is incorrect.");
      const encoded = await passwordHash(newPassword);
      db.exec("BEGIN");
      try {
        run("UPDATE users SET password=? WHERE id=?", encoded, req.user.id);
        run("DELETE FROM sessions WHERE user_id=?", req.user.id);
        run(
          "DELETE FROM native_tokens WHERE device_id IN (SELECT id FROM devices WHERE user_id=?)",
          req.user.id,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      session(res, req.user);
      res.json({ ok: true });
    },
  );
  app.delete("/api/account/devices/:id", requireUser, (req, res) => {
    if (req.user.demo) throw fail(403, "Demo devices are read-only.");
    const owned = query(
      "SELECT id FROM devices WHERE id=? AND user_id=?",
      req.params.id,
      req.user.id,
    );
    if (!owned) throw fail(404, "Device not found.");
    const previous = query(
      "SELECT reset_at FROM device_resets WHERE user_id=?",
      req.user.id,
    );
    const now = Math.floor(Date.now() / 1000);
    if (previous && previous.reset_at + policy.resetDays * 86400 > now)
      throw fail(409, "Device resets are limited to once every five days.");
    run(
      "INSERT INTO device_resets VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET reset_at=excluded.reset_at",
      req.user.id,
      now,
    );
    const result = run(
      "DELETE FROM devices WHERE id=? AND user_id=?",
      req.params.id,
      req.user.id,
    );
    if (!result.changes) throw fail(404, "Device not found.");
    res.json({ ok: true });
  });
  app.post(
    "/api/billing/checkout",
    requireUser,
    limits.billing,
    (req, res, next) => {
      if (checkoutLocks.has(req.user.id))
        return next(
          fail(
            409,
            "Checkout is already being prepared. Please wait a moment.",
          ),
        );
      checkoutLocks.add(req.user.id);
      res.once("finish", () => checkoutLocks.delete(req.user.id));
      res.once("close", () => checkoutLocks.delete(req.user.id));
      next();
    },
    async (req, res) => {
      if (req.user.demo)
        throw fail(
          403,
          "Create your own account before purchasing a membership.",
        );
      const plan = plans.find((p) => p.id === req.body.plan);
      if (!plan) throw fail(400, "Choose a valid plan.");
      if (!stripe || !webhookSecret || !priceIds[plan.id])
        throw fail(
          503,
          "Checkout is not configured yet. No payment has been taken.",
        );
      const existing = query(
        "SELECT status FROM subscriptions WHERE user_id=?",
        req.user.id,
      );
      if (
        existing &&
        !["canceled", "incomplete_expired"].includes(existing.status)
      )
        throw fail(
          409,
          "Manage your existing subscription in the billing portal.",
        );
      const pending = query(
        "SELECT * FROM checkouts WHERE user_id=? AND expires>?",
        req.user.id,
        Math.floor(Date.now() / 1000),
      );
      if (pending) {
        const prior = await stripe.checkout.sessions.retrieve(
          pending.session_id,
        );
        if (prior.status === "complete")
          throw fail(
            409,
            "Payment is being confirmed. Please check your account shortly.",
          );
        if (prior.status === "open" && pending.plan === plan.id)
          return res.json({ url: pending.url });
        if (prior.status === "open")
          await stripe.checkout.sessions.expire(pending.session_id);
      }
      const price = await stripe.prices.retrieve(priceIds[plan.id]);
      if (
        !price.active ||
        Boolean(price.livemode) !== (billingMode === "live") ||
        price.currency !== "usd" ||
        price.unit_amount !== plan.amount ||
        price.recurring?.interval !== plan.interval ||
        price.recurring?.interval_count !== 1
      )
        throw fail(503, "Configured Stripe price does not match this plan.");
      let customer = req.user.stripe_customer;
      if (!customer) {
        const created = await stripe.customers.create(
          {
            email: req.user.email,
            name: req.user.name,
            metadata: { userId: req.user.id },
          },
          { idempotencyKey: `customer-${req.user.id}` },
        );
        customer = created.id;
        run(
          "UPDATE users SET stripe_customer=? WHERE id=?",
          customer,
          req.user.id,
        );
      }
      const checkout = await stripe.checkout.sessions.create(
        {
          customer,
          mode: "subscription",
          line_items: [{ price: price.id, quantity: 1 }],
          client_reference_id: req.user.id,
          subscription_data: { metadata: { userId: req.user.id } },
          success_url: `${origin}/account?checkout=success`,
          cancel_url: `${origin}/purchase?checkout=canceled`,
        },
        {
          idempotencyKey: `checkout-${req.user.id}-${plan.id}-${pending?.session_id || "first"}-${Math.floor(Date.now() / 300000)}`,
        },
      );
      run(
        "INSERT INTO checkouts VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,session_id=excluded.session_id,url=excluded.url,expires=excluded.expires",
        req.user.id,
        plan.id,
        checkout.id,
        checkout.url,
        checkout.expires_at,
      );
      res.json({ url: checkout.url });
    },
  );
  app.post(
    "/api/billing/portal",
    requireUser,
    limits.billing,
    async (req, res) => {
      if (!stripe || !req.user.stripe_customer || req.user.demo)
        throw fail(409, "There is no Stripe billing account to manage yet.");
      const portal = await stripe.billingPortal.sessions.create({
        customer: req.user.stripe_customer,
        return_url: `${origin}/account?tab=billing`,
        ...(portalConfiguration ? { configuration: portalConfiguration } : {}),
      });
      res.json({ url: portal.url });
    },
  );
  installNative(app, {
    db,
    signing,
    origin,
    production,
    allowDevLicenses,
    requireVerified,
    requireUser,
    ...policy,
    limits,
  });
  installRecovery(app, {
    db,
    origin,
    requireUser,
    authLimit,
    limits,
    passwordHash,
    queue,
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  if (production) {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    app.use(express.static(dist));
    app.get("/{*path}", (req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500)
      console.error(err.type || err.code || err.message);
    res.status(err.status || 500).json({
      error:
        err.status && err.status < 500
          ? err.message
          : err.status === 503
            ? err.message
            : "Something went wrong. Please try again.",
    });
  });
  return app;
}
