import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { db, transaction } from "./db.ts";
export async function enqueue(
  tx: Db,
  type: string,
  operation: string,
  key: string,
  payload: unknown,
) {
  const id = randomUUID();
  const r = await tx.query(
    "insert into kitchen.jobs(id,type,operation,dedup_key,payload) values($1,$2,$3,$4,$5) on conflict(dedup_key) do update set dedup_key=excluded.dedup_key returning *",
    [id, type, operation, key, JSON.stringify(payload)],
  );
  return r.rows[0];
}
export async function recoverExpired(tx: Db) {
  await tx.query(
    "update kitchen.jobs set status=case when dispatched then 'uncertain' when attempts>=max_attempts then 'failed' else 'queued' end,error=case when dispatched then 'העבודה נקטעה אחרי שליחה לספק; אין ניסיון חיוב אוטומטי נוסף' else 'ה-worker אותחל; העבודה תחודש' end,lease_until=null,lease_token=null,updated_at=now() where status='running' and lease_until<now()",
  );
  await tx.query(
    "update kitchen.ai_usage u set status='uncertain' from kitchen.jobs j where u.job_id=j.id and j.status='uncertain' and u.status in ('reserved','dispatched')",
  );
  await tx.query(
    "update kitchen.import_items i set status=case when j.status='queued' then 'queued' else 'failed' end,error=j.error,updated_at=now() from kitchen.jobs j where j.operation='extractRecipe' and j.payload->>'item_id'=i.id::text and coalesce((j.payload->>'generation')::int,1)=i.scan_generation and j.status in('queued','failed','uncertain') and i.status='processing'",
  );
}
export async function claim(tx: Db) {
  const token = randomUUID();
  const r = await tx.query(
    "update kitchen.jobs set status='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=$1,updated_at=now() where id=(select id from kitchen.jobs where status='queued' and run_after<=now() and attempts<max_attempts order by created_at for update skip locked limit 1) returning *",
    [token],
  );
  return r.rows[0] ?? null;
}
export class BlockedJob extends Error {}
export class UncertainJob extends Error {}
export class RetryableJob extends Error {}
export async function runOne(handler: (job: any) => Promise<unknown>) {
  await recoverExpired(db);
  const job = await transaction(claim);
  if (!job) return false;
  const heartbeat = setInterval(
    () =>
      void db
        .query(
          "update kitchen.jobs set lease_until=now()+interval '3 minutes' where id=$1 and lease_token=$2 and status='running'",
          [job.id, job.lease_token],
        )
        .catch(() => {}),
    30000,
  );
  try {
    const result = await handler(job);
    await db.query(
      "update kitchen.jobs set status='succeeded',result=$3,lease_until=null,updated_at=now() where id=$1 and lease_token=$2 and status='running'",
      [job.id, job.lease_token, JSON.stringify(result ?? {})],
    );
  } catch (e) {
    const err = e as Error;
    let status =
      e instanceof BlockedJob
        ? "blocked"
        : e instanceof UncertainJob
          ? "uncertain"
          : e instanceof RetryableJob && job.attempts < job.max_attempts
            ? "queued"
            : "failed";
    const current = await db.query(
      "select dispatched from kitchen.jobs where id=$1",
      [job.id],
    );
    if (
      current.rows[0]?.dispatched &&
      !(e instanceof RetryableJob) &&
      !(e instanceof BlockedJob)
    )
      status = "uncertain";
    await db.query(
      "update kitchen.jobs set status=$3,error=$4,dispatched=case when $3='queued' then false else dispatched end,lease_until=null,run_after=now()+($5::text||' seconds')::interval,updated_at=now() where id=$1 and lease_token=$2 and status='running'",
      [
        job.id,
        job.lease_token,
        status,
        err.message.slice(0, 1200),
        Math.min(120, 5 * 2 ** job.attempts),
      ],
    );
    if (job.type === "media")
      await db.query(
        "update kitchen.media set state='failed',metadata=metadata||$2::jsonb where id=$1",
        [
          job.payload.media_id,
          JSON.stringify({ processing_error: err.message.slice(0, 800) }),
        ],
      );
    if (job.operation === "extractRecipe")
      await db.query(
        "update kitchen.import_items set status=$2,error=$3,updated_at=now() where id=$1 and status not in('saved','merged','trash') and scan_generation=coalesce($4,1)",
        [
          job.payload.item_id,
          status === "blocked"
            ? "waiting_ai"
            : status === "queued"
              ? "queued"
              : "failed",
          err.message.slice(0, 1200),
          job.payload.generation ?? 1,
        ],
      );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
