import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import type { MeasurementConfig } from "../shared/measurements.ts";
export async function measurementPreferences(
  db: Db,
): Promise<MeasurementConfig> {
  const r =
    (await db.query("select preferences from kitchen.owner where id=1")).rows[0]
      ?.preferences ?? {};
  return {
    cup_ml: r.cup_ml ?? null,
    packages: Object.entries(r.package_weights ?? {}).map(
      ([ingredient, grams]) => ({ ingredient, grams: String(grams) }),
    ),
  };
}
export async function insertShoppingLine(
  tx: Db,
  listId: string,
  line: any,
  position = 0,
) {
  await tx.query(
    "insert into kitchen.shopping_items(id,list_id,name,unit,amount,source_refs,department,position,assumptions) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      listId,
      line.name,
      line.unit,
      JSON.stringify(line.amount),
      JSON.stringify(line.source_refs),
      line.department,
      position,
      line.assumptions ?? [],
    ],
  );
}
