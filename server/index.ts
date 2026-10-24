import { createApp } from "./app.ts";
import { migrate, pool } from "./db.ts";
await migrate();
const server = createApp().listen(
  Number(process.env.PORT || 3000),
  "0.0.0.0",
  () => console.log("המטבח שלי זמין בפורט " + (process.env.PORT || 3000)),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => void pool.end()));
