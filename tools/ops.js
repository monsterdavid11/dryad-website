import { openDatabase } from "../server/db.js";
import { backup } from "node:sqlite";
import { resolve } from "node:path";
const db = openDatabase(
  process.env.DATABASE_PATH || "./data/playoverlay.sqlite",
);
const [action, id] = process.argv.slice(2);
if (action === "status")
  console.log(
    JSON.stringify(
      {
        jobs: db
          .prepare(
            "SELECT kind,state,count(*) AS count FROM jobs GROUP BY kind,state",
          )
          .all(),
        failedJobs: db
          .prepare(
            "SELECT id,kind,attempts,error FROM jobs WHERE state='failed' ORDER BY created DESC LIMIT 25",
          )
          .all(),
        devices: db
          .prepare(
            "SELECT count(*) AS count FROM device_keys WHERE revoked_at IS NULL",
          )
          .get(),
        releases: db
          .prepare("SELECT channel,version,sha256,enabled FROM release_catalog")
          .all(),
      },
      null,
      2,
    ),
  );
else if (action === "retry") {
  if (!id) throw Error("Provide failed job id.");
  db.prepare(
    "UPDATE jobs SET state='pending',attempts=0,available=?,error=NULL WHERE id=? AND state='failed'",
  ).run(Date.now(), id);
} else if (action === "disable-release") {
  if (!["stable", "preview"].includes(id))
    throw Error("Choose stable or preview");
  db.prepare("UPDATE release_catalog SET enabled=0 WHERE channel=?").run(id);
} else if (action === "backup") {
  if (!id) throw Error("Provide a new backup file path.");
  await backup(db, resolve(id));
  console.log("Backup written. Store it securely; it contains account data.");
} else if (action === "prune") {
  const now = Date.now();
  db.prepare("DELETE FROM telemetry WHERE recorded_at<?").run(
    now - 90 * 86400000,
  );
  db.prepare("DELETE FROM jobs WHERE state='done' AND created<?").run(
    now - 7 * 86400000,
  );
  db.prepare("DELETE FROM native_challenges WHERE expires<?").run(
    Math.floor(now / 1000),
  );
  db.prepare("DELETE FROM native_tokens WHERE expires<?").run(
    Math.floor(now / 1000),
  );
  db.prepare("DELETE FROM recovery_tokens WHERE expires<?").run(
    Math.floor(now / 1000),
  );
  console.log("Expired operational records pruned.");
} else
  throw Error(
    "Use status, retry <job-id>, disable-release <channel>, backup <path>, or prune.",
  );
db.close();
