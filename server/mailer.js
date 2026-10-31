import nodemailer from "nodemailer";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
export function mailer({
  production = false,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const provider =
    env.EMAIL_PROVIDER ||
    (env.RESEND_API_KEY
      ? "resend"
      : env.SMTP_HOST
        ? "smtp"
        : production
          ? "none"
          : "spool");
  if (!["resend", "smtp", "none", "spool"].includes(provider))
    throw Error("Unknown EMAIL_PROVIDER");
  if (production && provider === "spool")
    throw Error("Local email spool is forbidden in production");
  const transport =
    provider === "smtp" && env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT) || 587,
          secure: env.SMTP_SECURE === "true",
          requireTLS: env.SMTP_SECURE !== "true",
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 20000,
          auth: env.SMTP_USER
            ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
            : undefined,
        })
      : null;
  return async (message) => {
    if (message.expiresAt && Date.now() >= message.expiresAt)
      return { skipped: "expired" };
    const body = {
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    };
    if (provider === "resend") {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
        throw Error("RESEND_API_KEY and EMAIL_FROM required");
      const payload = {
        ...body,
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      };
      // One stable key per message keeps queue retries from duplicating accepted sends.
      const idempotency = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      let response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `dryad-email/${idempotency}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw Object.assign(new Error("Email provider connection failed"), {
          code: "EMAIL_NETWORK",
        });
      }
      if (!response.ok) {
        // Provider responses can echo addresses/content. Never include them in errors/logs.
        throw Object.assign(
          new Error(`Email provider returned HTTP ${response.status}`),
          { code: `EMAIL_HTTP_${response.status}` },
        );
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw Error("Email provider returned an invalid response");
      }
      if (typeof result.id !== "string" || !result.id)
        throw Error("Email provider did not acknowledge the message");
      return { id: result.id };
    }
    if (transport) {
      if (!env.EMAIL_FROM) throw Error("EMAIL_FROM required");
      return transport.sendMail({
        ...body,
        ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      });
    } else {
      if (production || provider !== "spool")
        throw Error("Production email transport is not configured");
      const dir = resolve("data/mail");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        resolve(dir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify(message, null, 2),
        { mode: 0o600 },
      );
    }
  };
}
