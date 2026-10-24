import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudEnvironment } from "../server/cloud-config.ts";
import { supervise } from "../server/cloud.ts";
import { databasePoolConfig } from "../server/db.ts";
import { mediaLimits, hostingInfo } from "../server/limits.ts";
const configured = () => ({
  DATABASE_URL:
    "postgresql://user:synthetic-password@database.example.test/postgres",
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "private",
  S3_ENDPOINT: "https://storage.example.test/s3",
  S3_REGION: "test",
  AWS_ACCESS_KEY_ID: "synthetic-access",
  AWS_SECRET_ACCESS_KEY: "synthetic-secret",
  RENDER_EXTERNAL_URL: "https://kitchen.example.test",
});
test("free cloud requires persistent remote data and private object storage, and derives secure origin", () => {
  const input = configured(),
    env = cloudEnvironment(input);
  assert.equal(env.APP_ORIGIN, input.RENDER_EXTERNAL_URL);
  assert.equal(env.COOKIE_SECURE, "true");
  assert.equal(env.DATABASE_SSL, "true");
  assert.equal(env.DATABASE_POOL_SIZE, "3");
  assert.ok(!("APP_ORIGIN" in input));
  assert.throws(
    () => cloudEnvironment({ ...input, STORAGE_DRIVER: "local" }),
    /STORAGE_DRIVER=s3/,
  );
  assert.throws(
    () =>
      cloudEnvironment({
        ...input,
        DATABASE_URL: "postgresql://user:synthetic@localhost/kitchen",
      }),
    /PostgreSQL/,
  );
  assert.throws(
    () =>
      cloudEnvironment({
        ...input,
        S3_ENDPOINT: "http://storage.example.test",
      }),
    /HTTPS/,
  );
  assert.throws(
    () => cloudEnvironment({ ...input, AWS_SECRET_ACCESS_KEY: "" }),
    /AWS_SECRET_ACCESS_KEY/,
  );
  assert.throws(
    () =>
      cloudEnvironment({
        ...input,
        DATABASE_URL: "synthetic-secret-not-a-url",
      }),
    (error) =>
      error instanceof Error && !error.message.includes("synthetic-secret"),
  );
});
test("a crashed cloud worker stops its sibling so the platform can restart both processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kitchen-supervisor-"));
  try {
    const marker = join(directory, "stopped"),
      survivor = join(directory, "survivor.ts"),
      crash = join(directory, "crash.ts");
    await writeFile(
      survivor,
      `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});setInterval(()=>{},1000);`,
    );
    await writeFile(crash, "setTimeout(()=>process.exit(7),500);");
    assert.equal(await supervise([survivor, crash], process.env, 2000), 7);
    assert.equal(await readFile(marker, "utf8"), "stopped");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("cloud database TLS verifies the certificate even when a copied URI includes sslmode", () => {
  const config = databasePoolConfig({
    DATABASE_URL: configured().DATABASE_URL + "?sslmode=no-verify",
    DATABASE_SSL: "true",
    DATABASE_CA_PEM: "first\\nsecond",
    DATABASE_POOL_SIZE: "3",
  });
  assert.equal(
    new URL(config.connectionString!).searchParams.has("sslmode"),
    false,
  );
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: "first\nsecond",
  });
  assert.equal(config.max, 3);
});
test("free profile announces suspension and exposes the lower media and upload limits", () => {
  const previous = process.env.CLOUD_PROFILE;
  try {
    process.env.CLOUD_PROFILE = "render-free";
    assert.equal(hostingInfo().may_sleep, true);
    assert.equal(mediaLimits().image_mb, 10);
    assert.equal(mediaLimits().upload_concurrency, 1);
    assert.equal(mediaLimits().video_minutes, 5);
  } finally {
    if (previous === undefined) delete process.env.CLOUD_PROFILE;
    else process.env.CLOUD_PROFILE = previous;
  }
});
