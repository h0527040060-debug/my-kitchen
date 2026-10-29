import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { S3Store, LocalStore, ObjectRangeError } from "../server/storage.ts";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
async function collect(stream: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("S3 adapter preserves private binary originals and endpoint prefixes with a local protocol test server", async () => {
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const objectPath = new URL(req.url!, "http://local.test").pathname;
    if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
      res.writeHead(403, { "Content-Type": "application/xml" });
      res.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(objectPath, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"synthetic"' });
      res.end();
    } else {
      const bytes = objects.get(objectPath);
      if (!bytes) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Length": bytes.length });
        res.end();
        return;
      }
      const range = req.headers.range;
      if (range) {
        const parsed = /^bytes=(\d+)-(\d*)$/.exec(range)!;
        const start = Number(parsed[1]),
          end = Math.min(
            parsed[2] ? Number(parsed[2]) : bytes.length - 1,
            bytes.length - 1,
          );
        if (start >= bytes.length) {
          res.writeHead(416, { "Content-Type": "application/xml" });
          res.end("<Error><Code>InvalidRange</Code></Error>");
          return;
        }
        res.writeHead(206, {
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        });
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.writeHead(200, { "Content-Length": bytes.length });
        res.end(bytes);
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  const values = {
    S3_ENDPOINT: origin + "/storage/v1/s3",
    S3_REGION: "us-east-1",
    S3_BUCKET: "private-recipes",
    S3_FORCE_PATH_STYLE: "true",
    AWS_ACCESS_KEY_ID: "synthetic-local-test",
    AWS_SECRET_ACCESS_KEY: "synthetic-local-secret",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  const store = new S3Store();
  try {
    const bytes = Buffer.from([0, 255, 127, 0, 13, 10]);
    await store.put("original/בדיקה עם רווח.png", bytes, "image/png");
    assert.deepEqual(await store.get("original/בדיקה עם רווח.png"), bytes);
    const partial = await store.open("original/בדיקה עם רווח.png", {
      start: 1,
      end: 3,
    });
    assert.deepEqual(partial.range, { start: 1, end: 3, total: bytes.length });
    assert.deepEqual(await collect(partial.stream), bytes.subarray(1, 4));
    const openEnded = await store.open("original/בדיקה עם רווח.png", {
      start: 4,
    });
    assert.deepEqual(await collect(openEnded.stream), bytes.subarray(4));
    await assert.rejects(
      store.open("original/בדיקה עם רווח.png", { start: 100 }),
      (e: any) => e instanceof ObjectRangeError && e.total === bytes.length,
    );
    const dir = await mkdtemp(join(tmpdir(), "kitchen-s3-stream-"));
    try {
      const path = join(dir, "source.bin"),
        copy = join(dir, "copy.bin");
      const large = Buffer.alloc(4 * 1024 * 1024, 73);
      await writeFile(path, large);
      await store.putFile(
        "streamed/large.bin",
        path,
        "application/octet-stream",
      );
      const object = await store.open("streamed/large.bin");
      assert.equal(object.length, large.length);
      await pipeline(object.stream, createWriteStream(copy));
      assert.deepEqual(await readFile(copy), large);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const path = [...objects.keys()][0];
    assert.match(
      decodeURI(path),
      /^\/storage\/v1\/s3\/private-recipes\/original\/בדיקה עם רווח.png$/,
    );
    assert.equal((await fetch(origin + path)).status, 403);
  } finally {
    store.client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("local file streams preserve originals, clamp byte ranges and reject ranges beyond EOF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kitchen-local-stream-"));
  try {
    const store = new LocalStore(join(dir, "objects"));
    const path = join(dir, "input.bin"),
      bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]);
    await writeFile(path, bytes);
    await store.putFile("private/original", path, "application/octet-stream");
    assert.deepEqual(await store.get("private/original"), bytes);
    const object = await store.open("private/original", { start: 2, end: 100 });
    assert.equal(object.length, 5);
    assert.deepEqual(object.range, { start: 2, end: 6, total: 7 });
    assert.deepEqual(await collect(object.stream), bytes.subarray(2));
    await assert.rejects(
      store.open("private/original", { start: 7 }),
      ObjectRangeError,
    );
    await assert.rejects(store.open("../outside"), /Invalid storage key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
