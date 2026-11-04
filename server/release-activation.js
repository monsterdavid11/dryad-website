import { createHash } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { backup } from "node:sqlite";

export async function activateRelease(db, manifestFile, databaseFile, signing) {
  if (!manifestFile) return null;
  const path = resolve(manifestFile),
    m = JSON.parse(readFileSync(path, "utf8"));
  if (
    !["stable", "preview"].includes(m.channel) ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    typeof m.file !== "string" ||
    basename(m.file) !== m.file ||
    !m.file.endsWith(".dll") ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 1024 ||
    !/^[a-f0-9]{16}$/.test(m.signingKeyId)
  )
    throw Error("Invalid protected release manifest");
  const data = readFileSync(resolve(dirname(path), m.file));
  if (
    data.length !== m.bytes ||
    createHash("sha256").update(data).digest("hex") !== m.sha256 ||
    data[0] !== 0x4d ||
    data[1] !== 0x5a
  )
    throw Error("Protected release binary failed integrity verification");
  if (signing && signing.kid !== m.signingKeyId)
    throw Error("License signing key does not match protected release");
  const root = dirname(resolve(databaseFile)),
    dir = resolve(root, "releases");
  mkdirSync(dir, { recursive: true });
  const existing = db
    .prepare("SELECT * FROM release_catalog WHERE channel=?")
    .get(m.channel);
  if (existing?.sha256 !== m.sha256 || existing?.version !== m.version) {
    const backups = resolve(root, "backups");
    mkdirSync(backups, { recursive: true });
    const snapshot = resolve(
      backups,
      `before-${m.channel}-${m.version}-${Date.now()}.sqlite`,
    );
    await backup(db, snapshot);
  }
  const target = resolve(dir, m.sha256 + ".dll");
  if (
    !existsSync(target) ||
    createHash("sha256").update(readFileSync(target)).digest("hex") !== m.sha256
  ) {
    copyFileSync(resolve(dirname(path), m.file), target + ".tmp");
    renameSync(target + ".tmp", target);
  }
  // Preserve an operator's explicit disable on later restarts of the same release.
  const enabled = existing?.sha256 === m.sha256 ? existing.enabled : 1;
  db.prepare(
    "INSERT INTO release_catalog VALUES(?,?,?,?,?,?)" +
      " ON CONFLICT(channel) DO UPDATE SET version=excluded.version,path=excluded.path,sha256=excluded.sha256,bytes=excluded.bytes,enabled=excluded.enabled",
  ).run(m.channel, m.version, target, m.sha256, m.bytes, enabled);
  return {
    channel: m.channel,
    version: m.version,
    sha256: m.sha256,
    bytes: m.bytes,
    enabled: !!enabled,
    signingReady: !!signing,
  };
}
