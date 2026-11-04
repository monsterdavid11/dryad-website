import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShieldCheck, Monitor, ArrowRight, Mail, Download } from "lucide-react";

export function SecurityPanel({ api, Button }) {
  const [verified, setVerified] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/account/security")
      .then((d) => setVerified(d.emailVerified))
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <section className="panel settings-panel">
      <h3>Email & privacy</h3>
      <p className="muted">
        {verified
          ? "Your email is verified."
          : "Verify your email before pairing a launcher."}
      </p>
      <Button
        className="secondary"
        disabled={busy || verified}
        onClick={async () => {
          setBusy(true);
          try {
            const d = await api("/account/verify-email", { method: "POST" });
            setMessage(d.message);
          } catch (e) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Mail size={16} />
        {verified ? "Email verified" : "Send verification email"}
      </Button>
      <p className="muted">
        <a href="/api/account/export" className="text-button">
          <Download size={15} /> Download your account data
        </a>
      </p>
      <Link className="text-button" to="/privacy">
        Privacy & usage reporting <ArrowRight size={14} />
      </Link>
      {message && (
        <p className="message notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
export default function MemberFlows({ kind, user, api, Button }) {
  const [params] = useSearchParams(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pair, setPair] = useState(null),
    [done, setDone] = useState(false);
  const code = (params.get("code") || "").toUpperCase(),
    purpose = params.get("purpose"),
    token = params.get("token");
  useEffect(() => {
    if (kind === "connect" && user && /^[A-F0-9]{8}$/.test(code))
      api("/account/pairing/" + code)
        .then(setPair)
        .catch((e) => setMessage(e.message));
  }, [kind, user, code]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const fields = Object.fromEntries(new FormData(e.currentTarget));
      let result;
      if (kind === "connect")
        result = await api("/account/pairing/approve", {
          method: "POST",
          body: { code },
        });
      else if (token)
        result = await api("/auth/recover", {
          method: "POST",
          body: { token, password: fields.password },
        });
      else result = await api("/auth/forgot", { method: "POST", body: fields });
      setMessage(
        result.message || "Device approved. Return to your Dryad launcher.",
      );
      setDone(true);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (kind === "privacy" || kind === "terms")
    return (
      <section className="policy-page">
        <span className="eyebrow">DRYAD ACCOUNT & MEMBERSHIP</span>
        <h1>
          {kind === "privacy"
            ? "Your data, in perspective."
            : "Membership policy."}
        </h1>
        {kind === "privacy" ? (
          <>
            <h2>What the service stores</h2>
            <p>
              Your email, display name, password hash, browser sessions, Stripe
              customer and subscription references, installation public keys,
              friendly device names, hashed computer identities, and usage
              aggregates. Stripe handles payment details.
            </p>
            <p>
              The launcher hashes your Windows installation identifier and
              hardware UUID to bind a license to this computer. Only that hash
              is sent to the service; the raw identifiers remain on your
              computer.
            </p>
            <h2>Usage reporting</h2>
            <p>
              The protected overlay writes local summaries of script runtime,
              completed runs, verified resource gains, and wall upgrades. The
              launcher sends these over authenticated requests; use{" "}
              <code>--no-telemetry</code> to disable sending. No game
              credentials, screenshots, raw input logs, or raw hardware
              identifiers are sent by this integration.
            </p>
            <h2>Control & retention</h2>
            <p>
              You can export account data and revoke devices in account
              management. A revoked device cannot renew a license; an existing
              signed lease lasts at most ten minutes. Operational pruning
              removes raw usage events after 90 days. Daily aggregates remain
              with your account. An account deletion and billing-retention
              process must be established before public launch.
            </p>
            <p>
              This page describes the local implementation. The final operator
              contact, hosting providers, and production retention policy are
              pending.
            </p>
          </>
        ) : (
          <>
            <h2>$5.99 monthly · $48.16 yearly</h2>
            <p>
              Subscriptions renew automatically at the selected interval. The
              yearly price reflects a 33% discount, rounded to the nearest cent.
            </p>
            <h2>Cancel whenever</h2>
            <p>
              Cancel future renewals in the Stripe billing portal. Access
              continues through the end of the paid period.
            </p>
            <h2>Refunds</h2>
            <p>
              Payments are non-refundable except where required by applicable
              law.
            </p>
            <h2>One registered device</h2>
            <p>
              A membership permits one registered device. You may reset a device
              once every five days. Removing a device immediately frees the
              slot; your replacement device can pair right away. Another reset
              is unavailable until the cooldown ends.
            </p>
            <p>
              Payments are processed securely by Stripe. Your account shows your
              subscription status and provides access to the billing portal.
            </p>
          </>
        )}
        <Button to="/account" className="secondary">
          Your account <ArrowRight size={16} />
        </Button>
      </section>
    );
  return (
    <section className="flow-page">
      <div className="auth-card">
        <span className="card-symbol">
          {kind === "connect" ? <Monitor /> : <ShieldCheck />}
        </span>
        <h2>
          {kind === "connect"
            ? "Connect your Dryad."
            : token && purpose === "verify"
              ? "Verify your email."
              : token
                ? "Choose a new password."
                : "Back in your flow."}
        </h2>
        <p>
          {kind === "connect"
            ? "Approve only a launcher sign-in that you started."
            : token
              ? "This link can be used once."
              : "Enter your account email for recovery instructions."}
        </p>
        {kind === "connect" && !user ? (
          <Button
            className="full"
            to={"/login?next=connect&code=" + encodeURIComponent(code)}
          >
            Sign in to approve <ArrowRight size={15} />
          </Button>
        ) : (
          <form onSubmit={submit}>
            {kind === "connect" ? (
              <>
                <label>
                  Pairing code
                  <input value={code} readOnly />
                </label>
                {pair && (
                  <p className="message notice">
                    Device: <b>{pair.name}</b>
                    <br />
                    One device per membership. Removing it starts the five-day
                    reset cooldown.
                  </p>
                )}
              </>
            ) : !token ? (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            ) : purpose !== "verify" ? (
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
            ) : null}
            <Button
              className="full"
              disabled={busy || done || (kind === "connect" && !pair)}
            >
              {kind === "connect"
                ? "Approve this device"
                : token && purpose === "verify"
                  ? "Verify email"
                  : token
                    ? "Reset password"
                    : "Send recovery instructions"}
              <ArrowRight size={15} />
            </Button>
          </form>
        )}
        {message && (
          <p className="message notice" role="status">
            {message}
          </p>
        )}
        <Link className="text-button" to="/login">
          Back to login
        </Link>
      </div>
    </section>
  );
}
