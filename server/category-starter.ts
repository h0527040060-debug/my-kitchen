import type { Db } from "./db.ts";
import { categoryPaths, categoryMove } from "./recipes.ts";
import { starterPaths } from "../shared/category-themes.ts";
export async function installCategoryStarter(tx: Db) {
  await tx.query("select pg_advisory_xact_lock(746822)");
  await tx.query(
    "update kitchen.jobs set status='cancelled',error='פעולות ספק AI הוסרו מהאפליקציה' where type='ai' and operation<>'categoryImage' and status in('queued','blocked','failed')",
  );
  await tx.query(
    "update kitchen.import_items set status='waiting_chat',error=null where status='waiting_ai'",
  );
  const root = await categoryPaths(tx, [["בישול"], ["אפייה"], ["קינוחים"]]);
  const cooking = root.ids[0];
  // This operation is explicit and owner-approved, never a migration or an import side effect.
  for (const name of ["סלטים", "רטבים"]) {
    const existing = (
      await tx.query(
        "select * from kitchen.categories where parent_id is null and name=$1",
        [name],
      )
    ).rows[0];
    const sibling = (
      await tx.query(
        "select id from kitchen.categories where parent_id=$1 and name=$2",
        [cooking, name],
      )
    ).rows[0];
    if (existing && !sibling) await categoryMove(tx, existing.id, cooking);
  }
  const created = await categoryPaths(tx, starterPaths);
  const queued = await tx.query(
    "update kitchen.jobs j set status='queued',attempts=0,run_after=now(),error=null where j.operation='categoryImage' and j.status in('blocked','failed') and not j.dispatched and exists(select 1 from kitchen.categories c where c.id::text=j.payload->>'category_id' and c.media_id is null and not c.manual_image and c.image_revision=coalesce((j.payload->>'image_revision')::int,1)) returning id",
  );
  await tx.query(
    'update kitchen.owner set preferences=preferences||\'{"category_starter_version":"he-v1"}\'::jsonb where id=1',
  );
  return {
    created_images: root.created_images + created.created_images,
    requeued: queued.rows.length,
  };
}
