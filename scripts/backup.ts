import { pool } from "../server/db.ts";
import { store } from "../server/storage.ts";
import { backupTo, restoreFrom } from "../server/backup.ts";
const command = process.argv[2],
  directory = process.argv[3];
if (!["backup", "restore"].includes(command) || !directory)
  throw Error("שימוש: npm run backup -- תיקייה או npm run restore -- תיקייה");
const client = await pool.connect();
try {
  console.log(
    await (command === "backup"
      ? backupTo(client, store, directory)
      : restoreFrom(client, store, directory)),
  );
} finally {
  client.release();
  await pool.end();
}
