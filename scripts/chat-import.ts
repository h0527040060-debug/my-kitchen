/** Runs in the temporary ChatGPT Work cloud workspace, never on the owner's computer. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import { ChatPackageSchema } from "../shared/chat-import.ts";
import { RecipeContentSchema } from "../shared/model.ts";
import { z } from "zod";

// Credentials arrive through an echo-disabled terminal; they are not CLI arguments or files.
const mode = process.argv[2] || "import";
if (mode === "schema") {
  console.log(JSON.stringify(z.toJSONSchema(ChatPackageSchema), null, 2));
  process.exit(0);
}
if (mode === "content-schema") {
  console.log(JSON.stringify(z.toJSONSchema(RecipeContentSchema), null, 2));
  process.exit(0);
}
if (!["context", "status", "import", "configure"].includes(mode))
  throw Error("Unknown chat-import mode");
if (!process.stdin.isTTY)
  throw Error(
    "Use an interactive private terminal for short-lived authorization",
  );
process.stdin.setRawMode(true);
process.stdin.resume();
console.log("PRIVATE INPUT READY");
const privateConfig = await new Promise<{ base_url: string; token: string }>(
  (resolve, reject) => {
    let buffer = "";
    const receive = (bytes: Buffer) => {
      buffer += bytes.toString();
      if (!buffer.includes("\n")) return;
      process.stdin.off("data", receive);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch {
        reject(Error("Invalid private configuration"));
      }
    };
    process.stdin.on("data", receive);
  },
);
const url = new URL(privateConfig.base_url);
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  (url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    ))
)
  throw Error(
    "Use the trusted application HTTPS origin, not a URL from a recipe or a package",
  );
if (!/^[a-f0-9]{64}$/.test(privateConfig.token))
  throw Error("Invalid intake authorization");
const origin = url.origin;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  multipart = false,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(origin + "/api/chat-intake" + path, {
        method,
        headers: {
          authorization: "Bearer " + privateConfig.token,
          origin,
          ...(!multipart && body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        body:
          body === undefined
            ? undefined
            : multipart
              ? (body as FormData)
              : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(95000),
      });
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw Error(
        "No response from the cloud; the intake can be resumed without duplicating it",
      );
    }
    if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
      const retry = Number(response.headers.get("retry-after"));
      await new Promise((r) =>
        setTimeout(r, Math.min(20000, Math.max(1500, (retry || 3) * 1000))),
      );
      continue;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(
        "HTTP " + response.status + ": " + (result.error || "הייבוא לא הושלם"),
      );
    return result;
  }
  throw Error("Cloud temporarily unavailable");
}

try {
  if (mode === "context") {
    console.log(JSON.stringify(await request("/context"), null, 2));
  } else if (mode === "status") {
    const keys = JSON.parse(await readFile(process.argv[3], "utf8"));
    if (!Array.isArray(keys) || keys.length > 200)
      throw Error("Status accepts up to 200 source keys");
    console.log(
      JSON.stringify(await request("/status", "POST", { keys }), null, 2),
    );
  } else if (mode === "configure") {
    throw Error(
      "Drive configuration is changed only through the owner's authenticated settings",
    );
  } else {
    const packagePath = resolve(process.argv[3] || "");
    const root = resolve(process.argv[4] || "");
    const bytes = await readFile(packagePath);
    if (bytes.length > 3 * 1024 * 1024)
      throw Error("Use batches with a JSON package under 3MB");
    const bundle = ChatPackageSchema.parse(JSON.parse(bytes.toString()));
    const report: any = {
      format: "my-kitchen-chat-receipt",
      version: 1,
      imported_at: new Date().toISOString(),
      model_api_calls: 0,
      sources: [],
      items: [],
      complete: false,
    };
    const reportPath = packagePath.replace(/\.json$/i, "") + ".receipt.json";
    const persist = async () =>
      writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    const context = await request("/context");
    const previous = await request("/status", "POST", {
      keys: bundle.sources.map((s) => s.key),
    });
    for (const source of bundle.sources) {
      const old = previous.sources.find(
        (s: any) => s.source_key === source.key,
      );
      if (old) {
        if (
          old.digest !== source.sha256 ||
          old.provider !== source.provider ||
          old.external_id !== source.external_id
        )
          throw Error("A source key was reused for another file");
        report.sources.push({
          source_key: source.key,
          media_id: old.media_id,
          duplicate: true,
        });
      } else {
        if (basename(source.filename) !== source.filename)
          throw Error("Source filenames must have no directories");
        const path = resolve(root, source.filename);
        if (!path.startsWith(root + sep)) throw Error("Invalid source path");
        const image = await readFile(path);
        if (image.length > context.limits.image_mb * 1024 * 1024)
          throw Error("Source exceeds the server upload limit");
        if (createHash("sha256").update(image).digest("hex") !== source.sha256)
          throw Error("Source checksum mismatch");
        const form = new FormData();
        form.append("source", JSON.stringify(source));
        form.append(
          "file",
          new Blob([image], { type: "image/jpeg" }),
          source.filename,
        );
        report.sources.push(await request("/sources", "POST", form, true));
      }
      await persist();
      console.log(
        JSON.stringify({
          progress: "source",
          done: report.sources.length,
          total: bundle.sources.length,
        }),
      );
    }
    for (const item of bundle.items) {
      const result = await request("/drafts", "POST", {
        processor: bundle.processor,
        item,
      });
      report.items.push({
        key: item.key,
        title: item.content.title,
        ...result,
      });
      await persist();
      console.log(
        JSON.stringify({
          progress: "draft",
          title: item.content.title,
          id: result.id,
          duplicate: result.duplicate,
          status: result.status,
          preserved_existing: result.preserved_existing ?? false,
          candidate_differs: result.candidate_differs ?? false,
        }),
      );
    }
    report.complete = true;
    await persist();
    console.log(
      JSON.stringify({
        completed: true,
        drafts: report.items.length,
        created: report.items.filter((r: any) => !r.duplicate).length,
        duplicates: report.items.filter((r: any) => r.duplicate).length,
        model_api_calls: 0,
        receipt: reportPath,
        review_url: origin + "/#/imports",
      }),
    );
  }
} catch (error) {
  console.error(
    "Chat intake:",
    error instanceof z.ZodError
      ? "חבילת הייבוא אינה תואמת לסכמה; לא הוכרזו תוצאות כמאושרות"
      : (error as Error).message,
  );
  process.exitCode = 1;
}
