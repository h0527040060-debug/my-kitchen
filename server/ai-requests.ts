import type { Db } from "./db.ts";
import { enqueue } from "./jobs.ts";
export async function requestedImage(
  tx: Db,
  operation: string,
  scope: string,
  payload: any,
  key: string,
) {
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    operation + ":" + scope,
  ]);
  const existing = await tx.query(
    "select * from kitchen.jobs where operation=$1 and payload->>'recipe_id'=$2 and coalesce(payload->>'prompt','')=$3 and coalesce(payload->>'media_id','')=$4 and status in('queued','running','blocked','uncertain') order by created_at desc limit 1",
    [operation, scope, payload.prompt ?? "", payload.media_id ?? ""],
  );
  if (existing.rows.length) return existing.rows[0];
  return enqueue(tx, "ai", operation, key, payload);
}
