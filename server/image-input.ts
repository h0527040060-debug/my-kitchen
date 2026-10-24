import sharp from "sharp";
import { mediaLimits } from "./limits.ts";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function normalizedImage(bytes: Buffer): Promise<Buffer> {
  const meta = await sharp(bytes, {
    limitInputPixels: mediaLimits().image_pixels,
  }).metadata();
  try {
    return await sharp(bytes, { limitInputPixels: mediaLimits().image_pixels })
      .rotate()
      .png()
      .toBuffer();
  } catch (error) {
    if (meta.format !== "heif") throw error;
    const dir = await mkdtemp(join(tmpdir(), "kitchen-heif-"));
    try {
      const input = join(dir, "source.heic"),
        output = join(dir, "source.png");
      await writeFile(input, bytes);
      await exec("heif-convert", [input, output], {
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      });
      return sharp(await readFile(output), {
        limitInputPixels: mediaLimits().image_pixels,
      })
        .rotate()
        .png()
        .toBuffer();
    } catch {
      throw Error(
        "לא ניתן לפענח את תמונת HEIC. יש לוודא שהותקן heif-convert או לבחור עותק JPEG קריא. המקור נשמר ללא שינוי.",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
