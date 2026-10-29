import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve, dirname, sep } from "node:path";
export interface ObjectRange {
  start: number;
  end?: number;
}
export interface StoredObject {
  stream: Readable;
  length: number;
  range?: { start: number; end: number; total: number };
}
export class ObjectRangeError extends Error {
  total: number;
  constructor(total: number) {
    super("Unsatisfiable object range");
    this.total = total;
  }
}
export interface ObjectStore {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  open(key: string, range?: ObjectRange): Promise<StoredObject>;
  size(key: string): Promise<number>;
  putFile(key: string, path: string, mime: string): Promise<void>;
}
export class LocalStore implements ObjectStore {
  root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  path(key: string) {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw Error("Invalid storage key");
    return path;
  }
  async put(key: string, bytes: Buffer, _mime: string) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = path + "." + crypto.randomUUID() + ".tmp";
    await writeFile(temp, bytes, { mode: 0o600 });
    await rename(temp, path);
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async size(key: string) {
    return (await stat(this.path(key))).size;
  }
  async open(key: string, range?: ObjectRange): Promise<StoredObject> {
    const total = await this.size(key);
    if (!range)
      return { stream: createReadStream(this.path(key)), length: total };
    const end = Math.min(range.end ?? total - 1, total - 1);
    if (range.start >= total || range.start > end)
      throw new ObjectRangeError(total);
    return {
      stream: createReadStream(this.path(key), { start: range.start, end }),
      length: end - range.start + 1,
      range: { start: range.start, end, total },
    };
  }
  async putFile(key: string, path: string, _mime: string) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = target + "." + crypto.randomUUID() + ".tmp";
    try {
      await pipeline(
        createReadStream(path),
        createWriteStream(temp, { mode: 0o600 }),
      );
      await rename(temp, target);
    } catch (error) {
      const { unlink } = await import("node:fs/promises");
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
export class S3Store implements ObjectStore {
  client: S3Client;
  bucket: string;
  constructor() {
    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 10000, requestTimeout: 60000 },
    });
    this.bucket = process.env.S3_BUCKET!;
  }
  async put(key: string, bytes: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
  }
  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw Error("Object missing");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  async size(key: string) {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (result.ContentLength === undefined) throw Error("Object size missing");
    return result.ContentLength;
  }
  async open(key: string, range?: ObjectRange): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range
            ? { Range: `bytes=${range.start}-${range.end ?? ""}` }
            : {}),
        }),
      );
      if (!result.Body || result.ContentLength === undefined)
        throw Error("Object body or size missing");
      let actualRange: StoredObject["range"];
      if (range) {
        const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          result.ContentRange ?? "",
        );
        if (!parsed) {
          (result.Body as Readable).destroy();
          throw Error("Object store did not honor byte range");
        }
        actualRange = {
          start: Number(parsed[1]),
          end: Number(parsed[2]),
          total: Number(parsed[3]),
        };
      }
      return {
        stream: result.Body as Readable,
        length: result.ContentLength,
        range: actualRange,
      };
    } catch (error) {
      if ((error as any)?.$metadata?.httpStatusCode === 416)
        throw new ObjectRangeError(await this.size(key));
      throw error;
    }
  }
  async putFile(key: string, path: string, mime: string) {
    // Create a fresh file stream for each retry; a consumed stream cannot be replayed.
    const length = (await stat(path)).size;
    for (let attempt = 0; ; attempt++) {
      const body = createReadStream(path);
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentLength: length,
            ContentType: mime,
          }),
        );
        return;
      } catch (error) {
        const status = (error as any)?.$metadata?.httpStatusCode;
        if (attempt >= 1 || (status && status !== 429 && status < 500))
          throw error;
      } finally {
        body.destroy();
      }
    }
  }
}
export const store: ObjectStore =
  process.env.STORAGE_DRIVER === "s3"
    ? new S3Store()
    : new LocalStore(process.env.MEDIA_ROOT || "data/media");
