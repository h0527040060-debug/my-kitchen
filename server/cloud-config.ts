import type { Db } from "./db.ts";
import { createOwner } from "./auth.ts";
export class CloudConfigError extends Error {}

export function cloudEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  const required = [
    "DATABASE_URL",
    "S3_BUCKET",
    "S3_ENDPOINT",
    "S3_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  for (const key of required)
    if (!env[key]?.trim()) throw new CloudConfigError(`חסרה הגדרת ענן: ${key}`);
  const url = (value: string, field: string) => {
    try {
      return new URL(value);
    } catch {
      throw new CloudConfigError(`כתובת אינה תקינה בהגדרה ${field}`);
    }
  };
  const database = url(env.DATABASE_URL!, "DATABASE_URL");
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    ["localhost", "127.0.0.1", "[::1]", "db"].includes(database.hostname)
  )
    throw new CloudConfigError("הפעלת הענן דורשת PostgreSQL חיצוני וקבוע");
  if (env.STORAGE_DRIVER !== "s3")
    throw new CloudConfigError(
      "בשרת הענן החינמי נדרש STORAGE_DRIVER=s3; קבצים מקומיים אינם נשמרים אחרי שינה או פריסה",
    );
  if (url(env.S3_ENDPOINT!, "S3_ENDPOINT").protocol !== "https:")
    throw new CloudConfigError("אחסון הענן דורש נקודת S3 מאובטחת ב־HTTPS");
  env.APP_ORIGIN ||= env.RENDER_EXTERNAL_URL;
  if (
    !env.APP_ORIGIN ||
    url(env.APP_ORIGIN, "APP_ORIGIN").protocol !== "https:"
  )
    throw new CloudConfigError(
      "חסרה כתובת HTTPS של האפליקציה: APP_ORIGIN או RENDER_EXTERNAL_URL",
    );
  env.APP_ORIGIN = new URL(env.APP_ORIGIN).origin;
  env.COOKIE_SECURE = "true";
  env.DATABASE_SSL = "true";
  env.TRUST_PROXY_HOPS ||= "1";
  env.DATABASE_POOL_SIZE ||= "3";
  return env;
}

/** Call inside a transaction. No public registration route or default password. */
export async function ensureCloudOwner(tx: Db, env: NodeJS.ProcessEnv) {
  await tx.query("select pg_advisory_xact_lock(746824)");
  if ((await tx.query("select id from kitchen.owner where id=1")).rows.length)
    return false;
  if (
    !env.OWNER_EMAIL ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL) ||
    !env.OWNER_PASSWORD ||
    env.OWNER_PASSWORD.length < 12 ||
    env.OWNER_PASSWORD.length > 256
  )
    throw new CloudConfigError(
      "להפעלה ראשונה בלבד יש להגדיר OWNER_EMAIL וסיסמה פרטית OWNER_PASSWORD באורך 12–256 תווים",
    );
  await createOwner(tx, env.OWNER_EMAIL, env.OWNER_PASSWORD);
  return true;
}
