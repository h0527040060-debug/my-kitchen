import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const template = await readFile(".env.server.example", "utf8");
const password = randomBytes(24).toString("hex");
try {
  await writeFile(
    ".env",
    template
      .replaceAll("CHANGE_THIS_DATABASE_PASSWORD", password)
      .replaceAll(
        "CHANGE_THIS_ADMIN_PASSWORD",
        randomBytes(24).toString("hex"),
      ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "נוצר קובץ .env פרטי עם סיסמת מסד אקראית. אין צורך במפתח AI כדי להשתמש במתכונים.",
  );
} catch (e) {
  if ((e as any).code === "EEXIST") console.log("קובץ .env כבר קיים ולא שונה.");
  else throw e;
}
