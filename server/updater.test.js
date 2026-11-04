import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verify } from "node:crypto";
import { fixture } from "./test-fixture.js";
import { digest } from "./security.js";

test("native package updates bind signed metadata, one-use downloads, catalog state and device entitlement", async () => {
  const f = await fixture(),
    dir = mkdtempSync(resolve(tmpdir(), "dryad-updater-"));
  const content = Buffer.from("PK-test-package"),
    path = resolve(dir, "package.zip"),
    dllHash = "a".repeat(64);
  writeFileSync(path, content);
  f.db
    .prepare("INSERT INTO release_catalog VALUES(?,?,?,?,?,1)")
    .run("stable", "1.2.0", "unused.dll", dllHash, 2048);
  f.db
    .prepare("INSERT INTO release_packages VALUES(?,?,?,?,?)")
    .run("stable", dllHash, path, digest(content), content.length);
  try {
    const account = await f.register(),
      key = f.identity();
    f.grant(account.data.user);
    const auth = await f.pair(key, account);
    const manifest = async (artifact = "package") =>
      f.native(key, auth, "manifest", {
        refreshToken: auth.refreshToken,
        channel: "stable",
        artifact,
      });
    const first = await manifest();
    assert.equal(first.status, 200);
    const [h, p, s] = first.data.manifest.split(".");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(h + "." + p),
        f.signing.publicKey,
        Buffer.from(s, "base64url"),
      ),
    );
    const claims = JSON.parse(Buffer.from(p, "base64url"));
    assert.equal(claims.artifact, "package");
    assert.equal(claims.sha256, digest(content));
    assert.equal(claims.bytes, content.length);
    assert.equal(claims.version, "1.2.0");
    const url = f.base + new URL(claims.url).pathname;
    const download = await fetch(url);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await manifest("unknown")).status, 400);
    const legacy = await manifest("dll");
    assert.equal(legacy.status, 200);
    assert.equal(
      JSON.parse(Buffer.from(legacy.data.manifest.split(".")[1], "base64url"))
        .sha256,
      dllHash,
    );
    const link = async () =>
      f.base +
      new URL(
        JSON.parse(
          Buffer.from(
            (await manifest()).data.manifest.split(".")[1],
            "base64url",
          ),
        ).url,
      ).pathname;
    const disabled = await link();
    f.db.prepare("UPDATE release_catalog SET enabled=0").run();
    assert.equal((await fetch(disabled)).status, 404);
    f.db.prepare("UPDATE release_catalog SET enabled=1").run();
    const stale = await link();
    f.db.prepare("UPDATE release_catalog SET sha256=?").run("b".repeat(64));
    assert.equal((await fetch(stale)).status, 404);
    assert.equal((await manifest()).status, 404);
    f.db.prepare("UPDATE release_catalog SET sha256=?").run(dllHash);
    const expired = await link();
    f.db.prepare("UPDATE download_tokens SET expires=0").run();
    assert.equal((await fetch(expired)).status, 401);
    const missing = await link();
    rmSync(path);
    assert.equal((await fetch(missing)).status, 404);
    writeFileSync(path, content);
    const unpaid = await link();
    f.db.prepare("DELETE FROM dev_entitlements").run();
    assert.equal((await fetch(unpaid)).status, 403);
    f.grant(account.data.user);
    const held = await link();
    f.db
      .prepare("INSERT INTO billing_holds VALUES(?,?,?)")
      .run("hold", account.data.user.id, "dispute");
    assert.equal((await fetch(held)).status, 403);
    f.db.prepare("DELETE FROM billing_holds").run();
    const revoked = await link();
    f.db.prepare("UPDATE device_keys SET revoked_at=1").run();
    assert.equal((await fetch(revoked)).status, 401);
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
