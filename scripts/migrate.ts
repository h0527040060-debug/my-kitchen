import { migrate, pool } from "../server/db.ts";
await migrate();
await pool.end();
console.log("המיגרציות הוחלו בהצלחה");
