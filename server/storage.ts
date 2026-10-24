import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
export interface ObjectStore {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
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
}
export const store: ObjectStore =
  process.env.STORAGE_DRIVER === "s3"
    ? new S3Store()
    : new LocalStore(process.env.MEDIA_ROOT || "data/media");
