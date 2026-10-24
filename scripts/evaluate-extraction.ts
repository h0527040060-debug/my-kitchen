import { readFile } from "node:fs/promises";
import { RecipeContentSchema } from "../shared/model.ts";
import { evaluateExtraction } from "../shared/evaluation.ts";
const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath)
  throw Error("שימוש: npm run ai:evaluate -- expected.json actual.json");
const read = async (path: string) => {
  const data = JSON.parse(await readFile(path, "utf8"));
  return RecipeContentSchema.parse(data.content ?? data);
};
console.log(
  JSON.stringify(
    evaluateExtraction(await read(expectedPath), await read(actualPath)),
    null,
    2,
  ),
);
