import nodemailer from "nodemailer";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
export function mailer({ production = false } = {}) {
  const transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        requireTLS: process.env.SMTP_SECURE !== "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
    : null;
  return async (message) => {
    if (transport) {
      if (!process.env.EMAIL_FROM) throw Error("EMAIL_FROM required");
      await transport.sendMail({ from: process.env.EMAIL_FROM, ...message });
    } else {
      if (production)
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
