import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase } from "./db.js";
import { activateRelease } from "./release-activation.js";

test("bundled protected release verifies integrity/pin, backs up data, persists catalog and preserves disable", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "dryad-activate-")),
    db = openDatabase(resolve(dir, "app.sqlite"));
  try {
    const data = Buffer.alloc(2048, 1);
    data[0] = 0x4d;
    data[1] = 0x5a;
    writeFileSync(resolve(dir, "Dryad.dll"), data);
    const zip = Buffer.alloc(2048, 2);
    zip[0] = 0x50;
    zip[1] = 0x4b;
    writeFileSync(resolve(dir, "Dryad.zip"), zip);
    const manifest = {
      channel: "stable",
      version: "1.0.0",
      file: "Dryad.dll",
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      signingKeyId: "1234567890abcdef",
      package: {
        file: "Dryad.zip",
        bytes: zip.length,
        sha256: createHash("sha256").update(zip).digest("hex"),
      },
    };
    const file = resolve(dir, "stable.json");
    writeFileSync(file, JSON.stringify(manifest));
    await assert.rejects(
      activateRelease(db, file, resolve(dir, "app.sqlite"), {
        kid: "fedcba0987654321",
      }),
      /does not match/,
    );
    const result = await activateRelease(db, file, resolve(dir, "app.sqlite"), {
      kid: manifest.signingKeyId,
    });
    assert.equal(result.signingReady, true);
    assert.equal(readdirSync(resolve(dir, "backups")).length, 1);
    const row = db.prepare("SELECT * FROM release_catalog").get();
    assert.deepEqual(readFileSync(row.path), data);
    assert.equal(row.enabled, 1);
    const pkg = db.prepare("SELECT * FROM release_packages").get();
    assert.deepEqual(readFileSync(pkg.path), zip);
    assert.equal(pkg.release_sha256, manifest.sha256);
    db.prepare("UPDATE release_catalog SET enabled=0").run();
    assert.equal(
      (await activateRelease(db, file, resolve(dir, "app.sqlite"), null))
        .enabled,
      false,
    );
    assert.equal(readdirSync(resolve(dir, "backups")).length, 1);
    writeFileSync(resolve(dir, "Dryad.zip"), Buffer.alloc(2048));
    await assert.rejects(
      activateRelease(db, file, resolve(dir, "app.sqlite"), null),
      /package failed integrity/,
    );
    writeFileSync(resolve(dir, "Dryad.zip"), zip);
    writeFileSync(resolve(dir, "Dryad.dll"), Buffer.alloc(2048));
    await assert.rejects(
      activateRelease(db, file, resolve(dir, "app.sqlite"), null),
      /integrity/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
