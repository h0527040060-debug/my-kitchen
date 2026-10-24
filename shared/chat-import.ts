import { z } from "zod";
import { RecipeContentSchema } from "./model.ts";

const key = z
  .string()
  .min(3)
  .max(350)
  .regex(/^[A-Za-z0-9_.:@+\-=]+$/);
export const ChatSourceSchema = z
  .object({
    key,
    provider: z.enum(["drive", "chat", "file"]),
    external_id: z.string().min(1).max(300),
    filename: z.string().min(1).max(250),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ChatProcessorSchema = z
  .object({
    kind: z.literal("chat_session"),
    name: z.string().min(1).max(100),
    model: z.string().min(1).max(100),
    prompt_version: z.literal("chat-import-he-v1"),
  })
  .strict();
export const ChatDraftSchema = z
  .object({
    key,
    source_keys: z.array(key).min(1).max(10),
    recipe_index: z.number().int().min(0).max(99).default(0),
    content: RecipeContentSchema,
    generated_fields: z.array(z.string().max(200)).max(200).default([]),
    suggestions: z
      .object({
        paths: z
          .array(z.array(z.string().min(1).max(100)).min(1).max(8))
          .max(20),
        reason: z.string().max(3000),
      })
      .strict(),
  })
  .strict();
export const ChatPackageSchema = z
  .object({
    format: z.literal("my-kitchen-chat-import"),
    version: z.literal(1),
    processor: ChatProcessorSchema,
    sources: z.array(ChatSourceSchema).min(1).max(100),
    items: z.array(ChatDraftSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set(value.sources.map((s) => s.key));
    if (keys.size !== value.sources.length)
      ctx.addIssue({ code: "custom", message: "מזהה מקור כפול בחבילה" });
    if (new Set(value.items.map((s) => s.key)).size !== value.items.length)
      ctx.addIssue({ code: "custom", message: "מזהה מתכון כפול בחבילה" });
    for (const item of value.items) {
      if (
        new Set(item.source_keys).size !== item.source_keys.length ||
        item.source_keys.some((k) => !keys.has(k))
      )
        ctx.addIssue({ code: "custom", message: "הפניית מקור חסרה או כפולה" });
    }
  });
export type ChatSource = z.infer<typeof ChatSourceSchema>;
export type ChatDraft = z.infer<typeof ChatDraftSchema>;
export type ChatPackage = z.infer<typeof ChatPackageSchema>;

export const DriveFoldersSchema = z
  .object({
    root: z.string().regex(/^[\w-]{10,200}$/),
    incoming: z.string().regex(/^[\w-]{10,200}$/),
    processed: z.string().regex(/^[\w-]{10,200}$/),
    archive: z.string().regex(/^[\w-]{10,200}$/),
    setup: z.string().regex(/^[\w-]{10,200}$/),
  })
  .strict();
