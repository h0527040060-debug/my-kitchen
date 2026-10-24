import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export interface Db {
  query<T = any>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export function databasePoolConfig(env: NodeJS.ProcessEnv): pg.PoolConfig {
  let connectionString = env.DATABASE_URL;
  if (env.DATABASE_SSL === "true" && connectionString) {
    const url = new URL(connectionString);
    for (const key of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"])
      url.searchParams.delete(key);
    connectionString = url.toString();
  }
  return {
    connectionString,
    max: Math.min(20, Math.max(1, Number(env.DATABASE_POOL_SIZE) || 10)),
    ssl:
      env.DATABASE_SSL === "true"
        ? {
            rejectUnauthorized: true,
            ...(env.DATABASE_CA_PEM
              ? { ca: env.DATABASE_CA_PEM.replaceAll("\\n", "\n") }
              : {}),
          }
        : undefined,
  };
}
export const pool = new pg.Pool(databasePoolConfig(process.env));
export const db: Db = pool;
export async function transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
export async function migrate(target: Db = db) {
  const client = target === db ? await pool.connect() : null;
  const conn: Db = client ?? target;
  try {
    await conn.query("create schema if not exists kitchen");
    await conn.query("revoke all on schema kitchen from public");
    await conn.query("select pg_advisory_lock(746823)");
    await conn.query(
      "create table if not exists kitchen.schema_migrations(name text primary key,applied_at timestamptz not null default now())",
    );
    for (const file of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const exists = await conn.query(
        "select name from kitchen.schema_migrations where name=$1",
        [file],
      );
      if (exists.rows.length) continue;
      await conn.query("begin");
      try {
        await conn.query(
          await readFile(
            new URL("../migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
        await conn.query(
          "insert into kitchen.schema_migrations(name) values($1)",
          [file],
        );
        await conn.query("commit");
      } catch (e) {
        await conn.query("rollback");
        throw e;
      }
    }
  } finally {
    await conn.query("select pg_advisory_unlock(746823)").catch(() => {});
    client?.release();
  }
}
