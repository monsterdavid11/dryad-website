import { openDatabase } from "../server/db.js";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const [channel, version, input] = process.argv.slice(2);
if (
  !["stable", "preview"].includes(channel) ||
  !/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(version || "") ||
  !input
)
  throw Error(
    "Usage: publish-release.js stable|preview 1.0.0 path-to-Dryad.dll",
  );
const bytes = readFileSync(resolve(input));
if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a)
  throw Error("Expected a Windows PE binary.");
const sha = createHash("sha256").update(bytes).digest("hex"),
  dir = resolve("data/releases");
mkdirSync(dir, { recursive: true });
const path = resolve(dir, sha + ".dll");
copyFileSync(resolve(input), path);
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
db.prepare(
  "INSERT INTO release_catalog VALUES(?,?,?,?,?,1) ON CONFLICT(channel) DO UPDATE SET version=excluded.version,path=excluded.path,sha256=excluded.sha256,bytes=excluded.bytes,enabled=1",
).run(channel, version, path, sha, bytes.length);
db.close();
console.log(
  `Published ${channel} ${version} (${sha}). Private files remain outside the public web directory.`,
);
