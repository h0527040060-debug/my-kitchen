import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { migrate, db, pool, transaction } from "../server/db.ts";
import { createOwner, passwordHash } from "../server/auth.ts";
await migrate();
const existing = (await db.query("select email from kitchen.owner where id=1"))
    .rows[0],
  reset = process.argv.includes("--reset");
if (existing && !reset) {
  console.error("כבר קיים חשבון בעלים. לא נוצר משתמש נוסף.");
  await pool.end();
  process.exit(1);
}
if (reset && !existing) throw Error("לא קיים חשבון לאיפוס");
let email = existing?.email;
if (!email) {
  const rl = createInterface({ input: stdin, output: stdout });
  email = await rl.question("אימייל בעלים: ");
  rl.close();
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error("אימייל אינו תקין");
async function hiddenPassword() {
  if (!stdin.isTTY) throw Error("נדרש מסוף אינטראקטיבי כדי להזין סיסמה");
  stdout.write("סיסמה (12 תווים לפחות, לא תוצג): ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString().replace(/\x1b\[(200|201)~/g, "");
      for (const char of s) {
        if (char === "\u0003" || char === "\u0004") {
          cleanup();
          reject(Error("בוטל"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\u0008") {
          value = [...value].slice(0, -1).join("");
          continue;
        }
        value += char;
      }
    };
    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    }
    stdin.on("data", onData);
  });
}
try {
  const password = await hiddenPassword();
  if (reset) {
    const hash = await passwordHash(password);
    await transaction(async (tx) => {
      await tx.query(
        "update kitchen.owner set password_hash=$1,recovery_hashes='{}' where id=1",
        [hash],
      );
      await tx.query("delete from kitchen.sessions");
      await tx.query(
        "update kitchen.chat_import_grants set revoked=true where not revoked",
      );
    });
    console.log(
      "סיסמת הבעלים עודכנה וכל ההתחברויות הקודמות בוטלו. הנתונים נשמרו.",
    );
  } else {
    await createOwner(db, email, password);
    console.log("חשבון הבעלים נוצר. אפשר להתחבר לאפליקציה.");
  }
} finally {
  await pool.end();
}
