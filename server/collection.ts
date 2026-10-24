import { z } from "zod";
import type { Db } from "./db.ts";
import { HttpError, requireValue } from "./errors.ts";
import { categoryPaths, categoryPreview, saveRecipe } from "./recipes.ts";
import { emptyRecipe } from "../shared/model.ts";
import { readiness } from "../shared/quantities.ts";

export const SelectionSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      recipe_revision: z.number().int().positive().nullable().optional(),
    }),
  )
  .min(1)
  .max(10000)
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "מזהה כפול בבחירה" });
  });
export const OptionalPaths = z
  .array(z.array(z.string().trim().min(1).max(100)).min(1).max(8))
  .max(20);
export const ImportBatchSchema = z.object({
  selection: SelectionSchema,
  overrides: z.record(z.string().uuid(), OptionalPaths).default({}),
});
export function importWhere(view: unknown) {
  return view === "trash"
    ? "i.status='trash'"
    : view === "saved"
      ? "i.status='saved'"
      : view === "pending"
        ? "i.status not in('saved','merged','trash')"
        : "i.status not in('merged','trash')";
}
export async function importRows(
  tx: Db,
  selection: z.infer<typeof SelectionSchema>,
  lock = false,
) {
  const rows = (
    await tx.query(
      "select i.* from kitchen.import_items i where i.id=any($1::uuid[]) order by i.id" +
        (lock ? " for update" : ""),
      [selection.map((r) => r.id)],
    )
  ).rows;
  if (rows.length !== selection.length)
    throw new HttpError(409, "הבחירה השתנתה; יש לרענן ולבחור שוב");
  for (const row of rows) {
    const input = selection.find((s) => s.id === row.id)!;
    if (row.revision !== input.revision)
      throw new HttpError(409, "פריט השתנה מאז הבחירה; יש לרענן לפני הפעולה");
  }
  return rows;
}
export async function previewImports(
  tx: Db,
  body: z.infer<typeof ImportBatchSchema>,
  lock = false,
) {
  const rows = await importRows(tx, body.selection, lock);
  const candidates = [];
  for (const row of rows) {
    if (row.status === "saved") continue;
    if (["trash", "merged", "processing"].includes(row.status))
      throw new HttpError(409, "פריט שנמחק, אוחד או מעובד אינו זמין לשמירה");
    const paths = OptionalPaths.parse(
      body.overrides[row.id] ??
        row.suggestions?.manual_paths ??
        row.suggestions?.paths ??
        [],
    );
    const content = row.draft ?? emptyRecipe();
    candidates.push({
      id: row.id,
      revision: row.revision,
      content,
      paths,
      title: content.title || "מתכון מתמונה",
      source_only: !row.draft,
      warnings: readiness(content),
      row,
    });
  }
  const preview = await categoryPreview(
    tx,
    candidates.flatMap((r) => r.paths),
  );
  return { candidates, ...preview };
}
export async function approveImportBatch(
  tx: Db,
  body: z.infer<typeof ImportBatchSchema>,
  expected: number,
) {
  await tx.query("select pg_advisory_xact_lock(746825)");
  await tx.query("select pg_advisory_xact_lock(746822)");
  const preview = await previewImports(tx, body, true);
  if (preview.new_images !== expected)
    throw new HttpError(409, "עץ הקטגוריות השתנה; יש לבדוק שוב את הסיכום");
  const result = [];
  for (const input of preview.candidates) {
    const row = input.row;
    const category = await categoryPaths(tx, input.paths);
    const recipe = await saveRecipe(tx, {
      content: input.content,
      status: "published",
      category_ids: category.ids,
      confirm_categories: true,
      reason: "שמירת אצווה במאגר; השלמת פרטים אפשרית בהמשך",
      field_sources: row.field_sources,
      ...(row.recipe_id
        ? { id: row.recipe_id, revision: row.base_recipe_revision }
        : {}),
    });
    await tx.query(
      "insert into kitchen.recipe_media(recipe_id,media_id,position) select $2,media_id,position from kitchen.import_media where item_id=$1 on conflict(recipe_id,media_id) do nothing",
      [row.id, recipe.id],
    );
    await tx.query(
      "update kitchen.recipes set primary_media_id=coalesce(primary_media_id,(select m.id from kitchen.import_media im join kitchen.media m on m.id=im.media_id where im.item_id=$2 and m.kind='image' order by im.position limit 1)) where id=$1",
      [recipe.id, row.id],
    );
    await tx.query(
      "update kitchen.import_items set status='saved',recipe_id=$2,draft=$3,updated_at=now(),scan_generation=scan_generation+1 where id=$1",
      [row.id, recipe.id, JSON.stringify(input.content)],
    );
    await tx.query(
      "update kitchen.jobs set status='cancelled' where operation='extractRecipe' and payload->>'item_id'=$1 and status in('queued','blocked')",
      [row.id],
    );
    result.push({ id: row.id, recipe_id: recipe.id, warnings: input.warnings });
  }
  return {
    items: result,
    saved: result.length,
    new_images: preview.new_images,
  };
}
export async function trashRecipe(tx: Db, id: string, revision: number) {
  await tx.query("select pg_advisory_xact_lock(746825)");
  const r = requireValue(
    (
      await tx.query("select * from kitchen.recipes where id=$1 for update", [
        id,
      ])
    ).rows[0],
  );
  if (r.revision !== revision)
    throw new HttpError(409, "המתכון השתנה; יש לרענן לפני מחיקה");
  if (r.status === "trash") return;
  await tx.query(
    "update kitchen.recipes set trash_previous_status=status,status='trash',deleted_at=now(),revision=revision+1 where id=$1",
    [id],
  );
  const imports = (
    await tx.query(
      "update kitchen.import_items set trash_previous_status=status,status='trash',deleted_at=now(),revision=revision+1,scan_generation=scan_generation+1 where recipe_id=$1 and status not in('trash','merged') returning id",
      [id],
    )
  ).rows;
  await cancelImports(
    tx,
    imports.map((i) => i.id),
  );
}
async function cancelImports(tx: Db, ids: string[]) {
  await tx.query(
    "update kitchen.jobs set status='cancelled' where operation='extractRecipe' and payload->>'item_id'=any($1::text[]) and status in('queued','blocked')",
    [ids],
  );
}
export async function restoreRecipe(tx: Db, id: string, revision?: number) {
  await tx.query("select pg_advisory_xact_lock(746825)");
  const r = requireValue(
    (
      await tx.query("select * from kitchen.recipes where id=$1 for update", [
        id,
      ])
    ).rows[0],
  );
  if (revision !== undefined && r.revision !== revision)
    throw new HttpError(409, "המתכון השתנה; יש לרענן לפני שחזור");
  if (r.status !== "trash") return;
  await tx.query(
    "update kitchen.import_items set status=case when trash_previous_status='saved' then 'saved' when draft is null then 'waiting_ai' else 'needs_review' end,trash_previous_status=null,deleted_at=null,revision=revision+1 where recipe_id=$1 and status='trash' and deleted_at=(select deleted_at from kitchen.recipes where id=$1)",
    [id],
  );
  await tx.query(
    "update kitchen.recipes set status=coalesce(trash_previous_status,'draft'),trash_previous_status=null,deleted_at=null,revision=revision+1 where id=$1",
    [id],
  );
}
export async function changeImportTrash(
  tx: Db,
  selection: z.infer<typeof SelectionSchema>,
  restore = false,
) {
  await tx.query("select pg_advisory_xact_lock(746825)");
  const rows = (
    await tx.query(
      "select * from kitchen.import_items where id=any($1::uuid[]) order by id for update",
      [selection.map((i) => i.id)],
    )
  ).rows;
  if (rows.length !== selection.length)
    throw new HttpError(409, "הבחירה השתנתה; יש לרענן");
  const seen = new Set<string>();
  for (const row of rows) {
    const input = selection.find((s) => s.id === row.id)!;
    if (restore ? row.status !== "trash" : row.status === "trash") continue;
    if (row.revision !== input.revision)
      throw new HttpError(409, "פריט השתנה; יש לרענן לפני הפעולה");
    if (row.recipe_id && !seen.has(row.recipe_id)) {
      if (!input.recipe_revision)
        throw new HttpError(409, "יש לרענן את גרסת המתכון לפני הפעולה");
      if (restore)
        await restoreRecipe(tx, row.recipe_id, input.recipe_revision);
      else await trashRecipe(tx, row.recipe_id, input.recipe_revision);
      seen.add(row.recipe_id);
    }
    if (restore) {
      await tx.query(
        "update kitchen.import_items set status=case when trash_previous_status='saved' then 'saved' when draft is null then 'waiting_ai' else 'needs_review' end,trash_previous_status=null,deleted_at=null,revision=revision+1 where id=$1 and status='trash'",
        [row.id],
      );
    } else {
      await tx.query(
        "update kitchen.import_items set trash_previous_status=status,status='trash',deleted_at=now(),revision=revision+1,scan_generation=scan_generation+1 where id=$1 and status not in('trash','merged')",
        [row.id],
      );
    }
  }
  if (!restore)
    await cancelImports(
      tx,
      selection.map((r) => r.id),
    );
  return { count: rows.length };
}
