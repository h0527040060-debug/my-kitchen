// Explicit, paid smoke check. Never runs as part of npm test or startup.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, pool, transaction } from "../server/db.ts";
import { enqueue } from "../server/jobs.ts";
import { OpenAIProvider, modelConfig } from "../server/ai.ts";
const source = process.argv[2];
if (
  process.env.AI_SMOKE_ALLOW_PAID !== "true" ||
  !process.env.OPENAI_API_KEY ||
  !source
)
  throw Error(
    "להפעלה מפורשת בלבד: הגדר מפתח שרת, AI_SMOKE_ALLOW_PAID=true, תקציב קריאות, ונתיב לתמונת מתכון אמיתית. הבדיקה עשויה לחייב את חשבון ה-API.",
  );
if (Number(process.env.AI_DAILY_MAX_CALLS || 0) < 3)
  throw Error(
    "נדרשת מכסת שלוש קריאות לפחות. זוהי מגבלת קריאות ולא הבטחה לעלות דולרית מסוימת.",
  );
const output = process.argv[3] || "data/ai-smoke";
await mkdir(output, { recursive: true, mode: 0o700 });
async function execute<T>(
  operation: string,
  fn: (p: OpenAIProvider) => Promise<T>,
) {
  const job = await transaction(async (tx) => {
    const j = await enqueue(tx, "ai", operation, "smoke:" + randomUUID(), {});
    return (
      await tx.query(
        "update kitchen.jobs set status='running',lease_token=$2,lease_until=now()+interval '10 minutes',attempts=1 where id=$1 returning *",
        [j.id, randomUUID()],
      )
    ).rows[0];
  });
  try {
    const result = await fn(new OpenAIProvider(job));
    await db.query(
      "update kitchen.jobs set status='succeeded',result=$2 where id=$1",
      [job.id, JSON.stringify({ smoke_test: true, operation })],
    );
    return result;
  } catch (error) {
    await db.query(
      "update kitchen.jobs set status=case when dispatched then 'uncertain' else 'blocked' end,error=$2 where id=$1",
      [job.id, (error as Error).message],
    );
    throw error;
  }
}
try {
  const image = await sharp(await readFile(source))
    .rotate()
    .resize(3200, 3200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();
  const recipe = await execute("extractRecipe", (p) =>
    p.extractRecipe([image]),
  );
  await writeFile(
    output + "/extraction.json",
    JSON.stringify(
      {
        real_api: true,
        model: modelConfig.vision,
        content: recipe,
        accuracy_verified: false,
        note: "יש להשוות ידנית כמויות, שברים, יחידות וקישורי הוראות למקור; פלט מובנה אינו הוכחת דיוק",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const generated = await execute("generateImage", (p) =>
    p.generateImage(
      "Natural food illustration, no text, based strictly on this recipe: " +
        JSON.stringify(recipe),
    ),
  );
  await writeFile(output + "/generated.webp", generated, { mode: 0o600 });
  const png = await sharp(generated).png().toBuffer();
  const edited = await execute("editImage", (p) =>
    p.editImage(
      png,
      "Improve warm lighting; retain the dish as closely as possible. No text.",
    ),
  );
  await writeFile(output + "/edited.webp", edited, { mode: 0o600 });
  console.log(
    "שלוש פעולות API חיות הושלמו. יש לבדוק את התוכן והתמונות ידנית בתיקיית הפלט.",
  );
} finally {
  await pool.end();
}
