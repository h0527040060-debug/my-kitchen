import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { RecipeContentSchema, type RecipeContent } from "../shared/model.ts";
import { applyEggDefault, readiness } from "../shared/quantities.ts";
import { HttpError, requireValue } from "./errors.ts";
import { fieldSources, type FieldSources } from "../shared/provenance.ts";
import { enqueue } from "./jobs.ts";
import {
  measurementDefaults,
  type MeasurementConfig,
} from "../shared/measurements.ts";
import { parseNumber } from "../shared/quantities.ts";
import { normalize } from "../shared/planning.ts";
export async function getRecipe(tx: Db, id: string) {
  const r = await tx.query(
    "select r.*,coalesce((select jsonb_agg(category_id) from kitchen.recipe_categories where recipe_id=r.id),'[]') as category_ids from kitchen.recipes r where id=$1",
    [id],
  );
  return requireValue(r.rows[0], "המתכון לא נמצא");
}
export async function saveRecipe(
  tx: Db,
  args: {
    id?: string;
    revision?: number;
    content: RecipeContent;
    status: string;
    category_ids: string[];
    confirm_categories: boolean;
    reason?: string;
    measurement_config?: MeasurementConfig;
    field_sources?: FieldSources;
  },
) {
  const content = RecipeContentSchema.parse(args.content);
  content.ingredients = content.ingredients.map(applyEggDefault);
  const ingredientIds = content.ingredients.map((i) => i.id),
    stepIds = content.steps.map((s) => s.id);
  if (
    new Set(ingredientIds).size !== ingredientIds.length ||
    new Set(stepIds).size !== stepIds.length
  )
    throw new HttpError(400, "מזהי מצרכים ושלבים חייבים להיות ייחודיים");
  if (args.status === "published") {
    const issues = readiness(content);
    if (!args.confirm_categories || !args.category_ids.length)
      issues.push("יש לבחור ולאשר קטגוריה");
    if (issues.length)
      throw new HttpError(422, "המתכון דורש השלמה לפני אישור", issues);
  }
  if (args.category_ids.length) {
    const cats = await tx.query(
      "select id from kitchen.categories where id=any($1::uuid[])",
      [args.category_ids],
    );
    if (cats.rows.length !== new Set(args.category_ids).size)
      throw new HttpError(400, "קטגוריה שנבחרה אינה קיימת");
  }
  const id = args.id ?? randomUUID();
  let revision = 1;
  let previousContent: RecipeContent | undefined,
    previousSources: FieldSources = {};
  let measurementConfig = args.measurement_config ?? measurementDefaults;
  if (args.id) {
    const previous = await tx.query(
      "select revision,measurement_config,content,field_sources from kitchen.recipes where id=$1 for update",
      [id],
    );
    const row = requireValue(previous.rows[0]);
    if (row.revision !== args.revision)
      throw new HttpError(
        409,
        "המתכון השתנה במכשיר אחר. יש לטעון את הגרסה החדשה לפני שמירה",
      );
    revision = row.revision + 1;
    previousContent = row.content;
    previousSources = row.field_sources;
    measurementConfig = args.measurement_config ?? row.measurement_config;
  }
  const searchText = [
    content.title,
    content.description,
    content.source_name,
    content.notes,
    content.story,
    ...content.ingredients.map((i) => i.original + " " + i.name),
    ...content.tags,
  ].join(" ");
  if (args.id)
    await tx.query(
      "update kitchen.recipes set revision=$2,status=$3,title=$4,content=$5,search_text=$6,active_minutes=$7,total_minutes=$8,classification=$9,difficulty=$10,tags=$11,updated_at=now(),deleted_at=null where id=$1",
      [
        id,
        revision,
        args.status,
        content.title,
        JSON.stringify(content),
        normalize(searchText),
        content.active_minutes,
        content.total_minutes,
        content.classification,
        content.difficulty,
        content.tags,
      ],
    );
  else
    await tx.query(
      "insert into kitchen.recipes(id,status,title,content,search_text,active_minutes,total_minutes,classification,difficulty,tags) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        args.status,
        content.title,
        JSON.stringify(content),
        normalize(searchText),
        content.active_minutes,
        content.total_minutes,
        content.classification,
        content.difficulty,
        content.tags,
      ],
    );
  await tx.query(
    "insert into kitchen.recipe_versions(id,recipe_id,revision,content,reason) values($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      id,
      revision,
      JSON.stringify(content),
      args.reason ?? "תיקון ידני",
    ],
  );
  for (const p of measurementConfig.packages)
    if (parseNumber(p.grams).n <= 0n)
      throw new HttpError(400, "משקל אריזה חייב להיות חיובי");
  await tx.query(
    "update kitchen.recipes set measurement_config=$2 where id=$1",
    [id, JSON.stringify(measurementConfig)],
  );
  await tx.query(
    "update kitchen.recipe_versions set measurement_config=$3 where recipe_id=$1 and revision=$2",
    [id, revision, JSON.stringify(measurementConfig)],
  );
  const provenance =
    args.field_sources ??
    fieldSources(content, "manual", previousContent, previousSources);
  await tx.query("update kitchen.recipes set field_sources=$2 where id=$1", [
    id,
    JSON.stringify(provenance),
  ]);
  await tx.query(
    "update kitchen.recipe_versions set field_sources=$3 where recipe_id=$1 and revision=$2",
    [id, revision, JSON.stringify(provenance)],
  );
  await tx.query("delete from kitchen.ingredients where recipe_id=$1", [id]);
  for (const [position, i] of content.ingredients.entries())
    await tx.query(
      "insert into kitchen.ingredients(id,recipe_id,position,group_name,name,unit,amount,original,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        i.id,
        id,
        position,
        i.group,
        i.name,
        i.unit,
        JSON.stringify(i.amount),
        i.original,
        JSON.stringify(i),
      ],
    );
  await tx.query("delete from kitchen.steps where recipe_id=$1", [id]);
  for (const [position, s] of content.steps.entries())
    await tx.query(
      "insert into kitchen.steps(id,recipe_id,position,group_name,text,details) values($1,$2,$3,$4,$5,$6)",
      [s.id, id, position, s.group, s.text, JSON.stringify(s)],
    );
  if (args.confirm_categories) {
    await tx.query("delete from kitchen.recipe_categories where recipe_id=$1", [
      id,
    ]);
    for (const cat of new Set(args.category_ids))
      await tx.query(
        "insert into kitchen.recipe_categories(recipe_id,category_id) values($1,$2)",
        [id, cat],
      );
  }
  return getRecipe(tx, id);
}
export async function categoryPaths(tx: Db, paths: string[][]) {
  await tx.query("select pg_advisory_xact_lock(746822)");
  const result: string[] = [];
  let created = 0;
  for (const path of paths) {
    if (!path.length || path.length > 8)
      throw new HttpError(400, "מסלול קטגוריה חייב לכלול 1–8 רמות");
    let parent: string | null = null;
    for (const nameRaw of path) {
      const name = nameRaw.trim();
      if (!name || name.length > 100)
        throw new HttpError(400, "שם קטגוריה אינו תקין");
      const existing: { rows: any[] } = await tx.query(
        "select * from kitchen.categories where parent_id is not distinct from $1::uuid and (normalized_name=$2 or $3=any(aliases))",
        [parent, normalize(name), name],
      );
      if (existing.rows.length) parent = existing.rows[0].id;
      else {
        const id = randomUUID();
        await tx.query(
          "insert into kitchen.categories(id,parent_id,name,normalized_name) values($1,$2,$3,$4)",
          [id, parent, name, normalize(name)],
        );
        await enqueue(tx, "ai", "categoryImage", `category-image:${id}:1`, {
          category_id: id,
          image_revision: 1,
        });
        parent = id;
        created++;
      }
    }
    if (parent) result.push(parent);
  }
  return { ids: [...new Set(result)], created_images: created };
}
export async function categoryPreview(tx: Db, paths: string[][]) {
  const categories = (await tx.query("select * from kitchen.categories")).rows;
  const newPaths = new Set<string>();
  for (const path of paths) {
    let parent: string | null = null;
    let missing = false;
    const full: string[] = [];
    for (const name of path) {
      full.push(normalize(name));
      const found =
        !missing &&
        categories.find(
          (c) =>
            c.parent_id === parent &&
            (c.normalized_name === normalize(name) ||
              c.aliases.some((a: string) => normalize(a) === normalize(name))),
        );
      if (found) parent = found.id;
      else {
        missing = true;
        newPaths.add(JSON.stringify(full));
      }
    }
  }
  return {
    new_images: newPaths.size,
    paths: [...newPaths].map((p) => JSON.parse(p)),
  };
}
export async function categoryMove(tx: Db, id: string, parent: string | null) {
  await tx.query("select pg_advisory_xact_lock(746822)");
  if (parent) {
    const descendant = await tx.query(
      "with recursive branch as(select id from kitchen.categories where id=$1 union all select c.id from kitchen.categories c join branch b on c.parent_id=b.id) select id from branch where id=$2",
      [id, parent],
    );
    if (descendant.rows.length)
      throw new HttpError(400, "אי אפשר ליצור מעגל בעץ הקטגוריות");
    requireValue(
      (
        await tx.query("select id from kitchen.categories where id=$1", [
          parent,
        ])
      ).rows[0],
    );
  }
  await tx.query("update kitchen.categories set parent_id=$2 where id=$1", [
    id,
    parent,
  ]);
}
