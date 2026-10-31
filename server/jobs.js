import { randomUUID } from "node:crypto";
export function jobQueue(db, handlers = {}) {
  let running = false;
  const enqueue = (kind, payload, id = randomUUID()) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,kind,payload,available,created) VALUES(?,?,?,?,?)",
      )
      .run(id, kind, JSON.stringify(payload), Date.now(), Date.now());
  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const job = db
        .prepare(
          "UPDATE jobs SET state='running',locked_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE (state='pending' AND available<=?) OR (state='running' AND locked_until<?) ORDER BY created LIMIT 1) RETURNING *",
        )
        .get(now + 300000, now, now);
      if (!job) return;
      try {
        if (!handlers[job.kind]) throw Error("No handler configured");
        await handlers[job.kind](JSON.parse(job.payload));
        db.prepare(
          "UPDATE jobs SET state='done',payload='{}',locked_until=NULL,error=NULL WHERE id=?",
        ).run(job.id);
      } catch (e) {
        db.prepare(
          "UPDATE jobs SET state=?,available=?,locked_until=NULL,error=? WHERE id=?",
        ).run(
          job.attempts >= 8 ? "failed" : "pending",
          now + Math.min(3600000, 1000 * 2 ** job.attempts),
          String(e.code || e.status || "processing_failed"),
          job.id,
        );
        console.error(
          JSON.stringify({
            event: "job_retry",
            kind: job.kind,
            id: job.id,
            attempt: job.attempts,
          }),
        );
      }
    } finally {
      running = false;
    }
  }
  return {
    enqueue,
    tick,
    handlers,
    start() {
      const timer = setInterval(tick, 1000);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
