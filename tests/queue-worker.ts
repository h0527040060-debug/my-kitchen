import { db, pool, transaction } from "../server/db.ts";
import { claim, runOne } from "../server/jobs.ts";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/kitchen_test")
)
  throw Error("Test database required");
if (process.argv[2] === "crash") {
  const job = await transaction(claim);
  if (!job) throw Error("No test job");
  await db.query(
    "insert into kitchen.test_effects(job_id) values($1) on conflict do nothing",
    [job.id],
  );
  process.send?.({ claimed: job.id });
  setInterval(() => {}, 1000);
} else {
  while (
    await runOne(async (job) => {
      if (job.type !== "test") throw Error("Unexpected test work");
      await db.query(
        "insert into kitchen.test_effects(job_id) values($1) on conflict do nothing",
        [job.id],
      );
      return { ok: true };
    })
  ) {}
  await pool.end();
}
