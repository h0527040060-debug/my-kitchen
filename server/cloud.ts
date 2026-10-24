import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  cloudEnvironment,
  ensureCloudOwner,
  CloudConfigError,
} from "./cloud-config.ts";

/** Separate API and worker processes share one free web-service allocation. */
export function supervise(
  entries: string[],
  env: NodeJS.ProcessEnv,
  graceMs = 20000,
) {
  return new Promise<number>((resolve) => {
    let stopping = false,
      remaining = entries.length,
      result = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const children = entries.map((entry) =>
      spawn(process.execPath, ["--experimental-strip-types", entry], {
        env,
        stdio: "inherit",
      }),
    );
    const stop = () => {
      if (stopping) return;
      stopping = true;
      for (const child of children) child.kill("SIGTERM");
      timer = setTimeout(() => {
        for (const child of children) child.kill("SIGKILL");
      }, graceMs);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    for (const child of children) {
      child.once("error", () => {
        result = 1;
        stop();
      });
      child.once("close", (code) => {
        if (!stopping) {
          result = code || 1;
          stop();
        }
        if (--remaining === 0) {
          clearTimeout(timer);
          process.off("SIGTERM", stop);
          process.off("SIGINT", stop);
          resolve(result);
        }
      });
    }
  });
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/cloud.ts")) {
  try {
    Object.assign(process.env, cloudEnvironment(process.env));
    const { migrate, transaction, pool } = await import("./db.ts");
    let created = false;
    try {
      await migrate();
      created = await transaction((tx) => ensureCloudOwner(tx, process.env));
    } finally {
      await pool.end();
    }
    if (created)
      console.log(
        "חשבון הבעלים נוצר מהגדרות השרת. אפשר להסיר כעת את משתני OWNER_EMAIL ו־OWNER_PASSWORD.",
      );
    delete process.env.OWNER_EMAIL;
    delete process.env.OWNER_PASSWORD;
    process.exitCode = await supervise(
      [
        fileURLToPath(new URL("./index.ts", import.meta.url)),
        fileURLToPath(new URL("./worker.ts", import.meta.url)),
      ],
      process.env,
    );
  } catch (error) {
    console.error(
      error instanceof CloudConfigError
        ? error.message
        : "הפעלת הענן נכשלה. יש לבדוק את הגדרות החיבור, האחסון הפרטי וחשבון הבעלים. סודות אינם מוצגים בלוג.",
    );
    process.exitCode = 1;
  }
}
