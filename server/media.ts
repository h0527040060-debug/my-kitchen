import sharp from "sharp";
import { normalizedImage } from "./image-input.ts";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "./db.ts";
import { db } from "./db.ts";
import { store, type ObjectStore } from "./storage.ts";
import { enqueue } from "./jobs.ts";
import { HttpError } from "./errors.ts";
const exec = promisify(execFile);
const MAX_IMAGE = 25 * 1024 * 1024,
  MAX_VIDEO = 150 * 1024 * 1024;
export async function registerMedia(
  tx: Db,
  bytes: Buffer,
  mime: string,
  origin: "source" | "personal" | "ai",
  extra: Record<string, unknown> = {},
  objectStore: ObjectStore = store,
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const existing = await tx.query(
    "select * from kitchen.media where digest=$1 and origin=$2",
    [digest, origin],
  );
  if (existing.rows.length) {
    await enqueue(tx, "media", "processMedia", `media:${existing.rows[0].id}`, {
      media_id: existing.rows[0].id,
    });
    return { ...existing.rows[0], duplicate: true };
  }
  let kind: string,
    actualMime = mime;
  if (mime.startsWith("image/")) {
    if (bytes.length > MAX_IMAGE) throw new HttpError(400, "תמונה עד 25MB");
    const meta = await sharp(bytes, {
      limitInputPixels: 80_000_000,
    }).metadata();
    if (
      !meta.width ||
      !["jpeg", "png", "webp", "heif", "avif", "tiff"].includes(meta.format)
    )
      throw new HttpError(400, "פורמט תמונה אינו נתמך");
    actualMime = meta.format === "jpeg" ? "image/jpeg" : `image/${meta.format}`;
    kind = "image";
  } else if (mime.startsWith("video/")) {
    if (bytes.length > MAX_VIDEO) throw new HttpError(400, "סרטון עד 150MB");
    if (
      bytes.subarray(4, 8).toString() !== "ftyp" &&
      bytes.subarray(0, 4).toString("hex") !== "1a45dfa3"
    )
      throw new HttpError(400, "פורמט הסרטון אינו נתמך");
    kind = "video";
  } else if (mime.startsWith("audio/")) {
    if (bytes.length > 20 * 1024 * 1024)
      throw new HttpError(400, "הקלטה עד 20MB");
    const head = bytes.subarray(0, 12);
    if (
      !["RIFF", "OggS"].includes(head.subarray(0, 4).toString()) &&
      head.subarray(0, 3).toString() !== "ID3" &&
      head.subarray(0, 4).toString("hex") !== "1a45dfa3" &&
      head.subarray(4, 8).toString() !== "ftyp" &&
      head[0] !== 255
    )
      throw new HttpError(400, "קובץ ההקלטה אינו מזוהה כמדיה תקינה");
    kind = "audio";
  } else throw new HttpError(400, "נדרש קובץ תמונה, סרטון או הקלטה");
  const id = randomUUID(),
    key = `original/${digest}`;
  await objectStore.put(key, bytes, actualMime);
  const r = await tx.query(
    "insert into kitchen.media(id,object_key,digest,mime,bytes,kind,origin,metadata) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(digest,origin) do update set digest=excluded.digest returning *",
    [
      id,
      key,
      digest,
      actualMime,
      bytes.length,
      kind,
      origin,
      JSON.stringify(extra),
    ],
  );
  await enqueue(tx, "media", "processMedia", `media:${r.rows[0].id}`, {
    media_id: r.rows[0].id,
  });
  return { ...r.rows[0], duplicate: false };
}
export async function processMedia(mediaId: string) {
  const r = await db.query("select * from kitchen.media where id=$1", [
    mediaId,
  ]);
  const media = r.rows[0];
  if (!media) throw Error("קובץ לא נמצא");
  const bytes = await store.get(media.object_key);
  const derivatives: Record<string, string> = {};
  const meta: Record<string, unknown> = { ...media.metadata };
  if (media.kind === "image") {
    const normalized = await normalizedImage(bytes);
    for (const [name, size, quality] of [
      ["thumbnail", 400, 72],
      ["display", 1600, 85],
      ["readable", 3200, 95],
    ] as const) {
      const out = await sharp(normalized, { limitInputPixels: 80_000_000 })
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      const key = `derived/${media.id}/${name}.webp`;
      await store.put(key, out, "image/webp");
      derivatives[name] = key;
    }
    const dimensions = await sharp(normalized).metadata();
    meta.width = dimensions.width;
    meta.height = dimensions.height;
    meta.processed = true;
  } else if (media.kind === "video") {
    const temp = await mkdtemp(join(tmpdir(), "kitchen-video-"));
    try {
      const input = join(temp, "input");
      await writeFile(input, bytes);
      const probe = await exec(
        "ffprobe",
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", input],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const info = JSON.parse(probe.stdout);
      const duration = Number(info.format?.duration);
      if (!Number.isFinite(duration) || duration > 1800)
        throw Error("סרטון חייב להיות באורך עד 30 דקות");
      await exec(
        "ffmpeg",
        [
          "-y",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          "scale=trunc(min(1280\\,iw)/2)*2:-2",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "26",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          join(temp, "video.mp4"),
        ],
        { timeout: 20 * 60000, maxBuffer: 1024 * 1024 },
      );
      await exec(
        "ffmpeg",
        [
          "-y",
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=600:-2",
          join(temp, "poster.jpg"),
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      for (const [name, file, mime] of [
        ["video", "video.mp4", "video/mp4"],
        ["poster", "poster.jpg", "image/jpeg"],
      ]) {
        const key = `derived/${media.id}/${file}`;
        await store.put(key, await readFile(join(temp, file)), mime);
        derivatives[name] = key;
      }
      meta.duration_seconds = duration;
      meta.processed = true;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  } else {
    const temp = await mkdtemp(join(tmpdir(), "kitchen-audio-"));
    try {
      const input = join(temp, "input");
      await writeFile(input, bytes);
      const output = join(temp, "audio.mp3");
      await exec(
        "ffmpeg",
        [
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          input,
          "-t",
          "601",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "24000",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "64k",
          output,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      const result = await exec(
        "ffprobe",
        ["-v", "error", "-show_format", "-of", "json", output],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const info = JSON.parse(result.stdout),
        duration = Number(info.format?.duration);
      if (!Number.isFinite(duration) || duration > 600)
        throw Error("הקלטה חייבת להיות באורך עד 10 דקות");
      const key = `derived/${media.id}/audio.mp3`;
      await store.put(key, await readFile(output), "audio/mpeg");
      derivatives.audio = key;
      meta.duration_seconds = duration;
      meta.processed = true;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  await db.query(
    "update kitchen.media set state='ready',derivatives=$2,metadata=$3 where id=$1",
    [mediaId, JSON.stringify(derivatives), JSON.stringify(meta)],
  );
  return { media_id: mediaId };
}
export async function imageForVision(
  mediaId: string,
  crop?: { left: number; top: number; width: number; height: number },
) {
  const r = await db.query("select * from kitchen.media where id=$1", [
    mediaId,
  ]);
  const m = r.rows[0];
  if (!m || m.kind !== "image") throw Error("מקור חייב להיות תמונה");
  let image = sharp(await normalizedImage(await store.get(m.object_key)), {
    limitInputPixels: 80_000_000,
  });
  if (crop) image = image.extract(crop);
  return image
    .resize(3200, 3200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();
}
