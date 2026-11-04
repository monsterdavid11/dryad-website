import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fixture } from "./test-fixture.js";

test("website package requires a verified paid account, honors billing holds and catalog revocation, and needs no paired device", async () => {
  const f = await fixture({ allowDevLicenses: false }),
    dir = mkdtempSync(resolve(tmpdir(), "dryad-download-"));
  const content = Buffer.from("PK-protected-package-fixture"),
    path = resolve(dir, "Dryad.zip"),
    sha = createHash("sha256").update(content).digest("hex");
  writeFileSync(path, content);
  f.db
    .prepare("INSERT INTO release_catalog VALUES(?,?,?,?,?,1)")
    .run("stable", "1.0.0", "unused.dll", "a".repeat(64), 2048);
  f.db
    .prepare("INSERT INTO release_packages VALUES(?,?,?,?,?)")
    .run("stable", "a".repeat(64), path, sha, content.length);
  try {
    assert.equal((await f.request("/account/release/download")).status, 401);
    const account = await f.register(),
      user = account.data.user,
      cookie = account.cookie;
    const download = () =>
      fetch(f.base + "/api/account/release/download", { headers: { cookie } });
    assert.equal((await download()).status, 403);
    f.db
      .prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,0)")
      .run(
        user.id,
        "sub_paid",
        "active",
        "monthly",
        Math.floor(Date.now() / 1000) + 3600,
      );
    assert.equal((await download()).status, 403);
    assert.equal(
      (await f.request("/account/release", { cookie })).data.emailVerified,
      false,
    );
    f.db
      .prepare("INSERT INTO verified_emails VALUES(?,?)")
      .run(user.id, Date.now());
    const info = (await f.request("/account/release", { cookie })).data;
    assert.equal(info.canDownload, true);
    assert.equal(info.release.path, undefined);
    assert.equal(info.release.sha256, sha);
    assert.equal(f.db.prepare("SELECT count(*) n FROM devices").get().n, 0);
    const response = await download();
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-disposition"),
      /Dryad-1.0.0.zip/,
    );
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
    f.db
      .prepare("INSERT INTO billing_holds VALUES(?,?,?)")
      .run("hold", user.id, "Dispute");
    assert.equal((await download()).status, 403);
    f.db.prepare("DELETE FROM billing_holds").run();
    f.db.prepare("UPDATE subscriptions SET period_end=1").run();
    assert.equal((await download()).status, 403);
    f.db
      .prepare("UPDATE subscriptions SET period_end=?")
      .run(Math.floor(Date.now() / 1000) + 3600);
    f.db.prepare("UPDATE release_catalog SET enabled=0").run();
    assert.equal((await download()).status, 404);
    f.db
      .prepare("UPDATE release_catalog SET enabled=1,sha256=?")
      .run("b".repeat(64));
    assert.equal((await download()).status, 404);
    f.db.prepare("UPDATE release_catalog SET sha256=?").run("a".repeat(64));
    rmSync(path);
    assert.equal((await download()).status, 404);
    await f.request("/auth/logout", { method: "POST", cookie });
    assert.equal((await download()).status, 401);
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
