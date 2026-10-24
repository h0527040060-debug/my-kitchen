import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { S3Store } from "../server/storage.ts";

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
      res.writeHead(200, { "Content-Length": bytes.length });
      res.end(bytes);
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
