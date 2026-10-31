const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

export function recoveryEmail({ origin, token, purpose, to, expiresAt }) {
  if (!["verify", "reset"].includes(purpose))
    throw Error("Unknown email purpose");
  const verification = purpose === "verify";
  const title = verification ? "Verify your email" : "Reset your password";
  const intro = verification
    ? "Confirm your email address to finish setting up your Dryad account."
    : "We received a request to reset your Dryad password.";
  const expiry = verification ? "24 hours" : "20 minutes";
  const link = new URL("/recover", origin);
  link.searchParams.set("purpose", purpose);
  link.searchParams.set("token", token);
  const url = link.href;
  const note = `This link expires in ${expiry} and can be used once. If you request another email, use the latest link.`;
  const ignore =
    "If you did not request this, you can safely ignore this email.";
  return {
    to,
    subject: verification
      ? "Verify your Dryad email"
      : "Reset your Dryad password",
    expiresAt,
    text: `${title}\n\n${intro}\n\n${url}\n\n${note}\n\n${ignore}\n\nDryad · ${new URL(origin).host}`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f2f8;font-family:Arial,sans-serif;color:#262330">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2ef;border-radius:18px">
<tr><td style="padding:30px 32px;background:#18151f;border-radius:18px 18px 0 0;color:#ffffff;font-size:26px;font-weight:bold">dryad<span style="color:#ae85ed">.</span></td></tr>
<tr><td style="padding:32px"><h1 style="font-size:25px;margin:0 0 18px">${title}</h1><p style="font-size:16px;line-height:1.6">${intro}</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#7843c7;border-radius:9px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${title}</a></td></tr></table>
<p style="font-size:13px;line-height:1.7;color:#655d70;margin-top:24px">${note}</p><p style="font-size:13px;line-height:1.7;color:#655d70">${ignore}</p>
<p style="font-size:12px;line-height:1.7;color:#655d70">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#7843c7;word-break:break-all">${escapeHtml(url)}</a></p>
</td></tr></table><p style="font-size:12px;color:#766e80">Dryad · ${escapeHtml(new URL(origin).host)}</p>
</td></tr></table></body></html>`,
  };
}
