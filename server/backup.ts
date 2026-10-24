import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, sep } from "node:path";
import type { Db } from "./db.ts";
import type { ObjectStore } from "./storage.ts";
export const backupTables = [
  "owner",
  "media",
  "categories",
  "category_images",
  "recipes",
  "recipe_versions",
  "recipe_categories",
  "ingredients",
  "steps",
  "recipe_media",
  "import_items",
  "import_media",
  "jobs",
  "ai_usage",
  "cooking",
  "timers",
  "meals",
  "meal_items",
  "meal_suggestion_acceptances",
  "preparation",
  "shopping_lists",
  "shopping_items",
  "pantry",
  "experiences",
  "experience_media",
  "assistant_messages",
];
function safe(root: string, key: string) {
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep))
    throw Error("נתיב קובץ בגיבוי אינו תקין");
  return path;
}
export async function backupTo(db: Db, store: ObjectStore, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const data: Record<string, unknown[]> = {};
  await db.query("begin isolation level repeatable read read only");
  try {
    for (const table of backupTables)
      data[table] = (await db.query(`select * from kitchen.${table}`)).rows;
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  const keys = new Set<string>();
  for (const m of data.media as any[]) {
    keys.add(m.object_key);
    for (const key of Object.values(m.derivatives) as string[]) keys.add(key);
  }
  const objects = [];
  for (const key of keys) {
    const bytes = await store.get(key),
      file = "objects/" + key;
    const path = safe(directory, file);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
    objects.push({
      key,
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    resolve(directory, "manifest.json"),
    JSON.stringify(
      {
        format: "my-kitchen-backup",
        version: 1,
        created_at: new Date().toISOString(),
        data,
        objects,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return { tables: backupTables.length, objects: objects.length };
}
export async function restoreFrom(
  db: Db,
  store: ObjectStore,
  directory: string,
) {
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== "my-kitchen-backup" ||
    manifest.version !== 1 ||
    !manifest.data ||
    !Array.isArray(manifest.objects)
  )
    throw Error("גיבוי אינו נתמך");
  for (const table of backupTables)
    if (!Array.isArray(manifest.data[table])) throw Error("טבלה חסרה בגיבוי");
  for (const table of backupTables) {
    const row = await db.query(`select 1 from kitchen.${table} limit 1`);
    if (row.rows.length)
      throw Error("שחזור מותר רק למסד חדש וריק; לא יידרס מידע קיים");
  }
  // Verify every media file before inserting any database rows.
  const loaded = [];
  for (const o of manifest.objects) {
    if (typeof o.key !== "string" || typeof o.file !== "string")
      throw Error("הפניית מדיה אינה תקינה");
    const bytes = await readFile(safe(directory, o.file));
    if (
      createHash("sha256").update(bytes).digest("hex") !== o.sha256 ||
      bytes.length !== o.bytes
    )
      throw Error("קובץ מדיה חסר או נפגם: " + o.key);
    loaded.push({ ...o, bytes });
  }
  for (const o of loaded)
    await store.put(o.key, o.bytes, "application/octet-stream");
  await db.query("begin");
  try {
    for (const table of backupTables) {
      const columnInfo = (
        await db.query(
          "select column_name,data_type from information_schema.columns where table_schema=$1 and table_name=$2",
          ["kitchen", table],
        )
      ).rows;
      const allowed = new Map(
        columnInfo.map((c) => [c.column_name, c.data_type]),
      );
      let rows = manifest.data[table];
      if (table === "categories") {
        // Parents before children, independent of export order.
        const sorted: any[] = [];
        const remaining = [...rows];
        while (remaining.length) {
          const i = remaining.findIndex(
            (r) =>
              r.parent_id === null || sorted.some((p) => p.id === r.parent_id),
          );
          if (i < 0) throw Error("עץ קטגוריות פגום");
          sorted.push(remaining.splice(i, 1)[0]);
        }
        rows = sorted;
      }
      if (table === "media") {
        // Edited/cropped images may refer to another source.
        const sorted: any[] = [];
        const remaining = [...rows];
        while (remaining.length) {
          const i = remaining.findIndex(
            (r) =>
              r.parent_id === null || sorted.some((p) => p.id === r.parent_id),
          );
          if (i < 0) throw Error("שרשרת מדיה פגומה");
          sorted.push(remaining.splice(i, 1)[0]);
        }
        rows = sorted;
      }
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.some((c) => !allowed.has(c))) throw Error("עמודה לא צפויה");
        const values = columns.map((c) =>
          ["json", "jsonb"].includes(String(allowed.get(c))) && row[c] !== null
            ? JSON.stringify(row[c])
            : row[c],
        );
        await db.query(
          `insert into kitchen.${table} (${columns.map((c) => '"' + c + '"').join(",")}) values(${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
      }
    } // A restore must never replay a possibly billed request.
    await db.query(
      "update kitchen.jobs set status=case when dispatched then 'uncertain' else 'queued' end,lease_until=null,lease_token=null where status='running'",
    );
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  return { objects: loaded.length, tables: backupTables.length };
}
