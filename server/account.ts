import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { db, transaction, type Db } from "./db.ts";
import { digest, passwordHash, verifyPassword } from "./auth.ts";
import { HttpError } from "./errors.ts";

const password = z.string().min(12).max(256);
async function newSession(tx: Db) {
  const token = randomBytes(32).toString("hex");
  await tx.query("delete from kitchen.sessions");
  await tx.query(
    "update kitchen.chat_import_grants set revoked=true where not revoked",
  );
  await tx.query(
    "insert into kitchen.sessions(token_hash,owner_id,expires_at) values($1,1,now()+interval '30 days')",
    [digest(token)],
  );
  return token;
}
function cookie(res: express.Response, token: string) {
  res.cookie("kitchen_session", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
export const recoveryLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
export async function recoverAccount(
  req: express.Request,
  res: express.Response,
) {
  const body = z
    .object({
      email: z.string().email(),
      code: z.string().regex(/^[a-f0-9]{64}$/),
      password,
    })
    .parse(req.body);
  const out = await transaction(async (tx) => {
    const owner = (
      await tx.query("select * from kitchen.owner where id=1 for update")
    ).rows[0];
    const hashes: string[] = owner?.recovery_hashes ?? [];
    const provided = Buffer.from(digest(body.code), "hex");
    let matched = false;
    for (const value of hashes.length ? hashes : ["0".repeat(64)])
      matched = timingSafeEqual(provided, Buffer.from(value, "hex")) || matched;
    if (!owner || !matched || owner.email !== body.email.trim().toLowerCase())
      throw new HttpError(
        401,
        "האימייל או קוד השחזור אינם תקינים או שהקוד כבר נוצל",
      );
    await tx.query(
      "update kitchen.owner set password_hash=$1,recovery_hashes=array_remove(recovery_hashes,$2) where id=1",
      [await passwordHash(body.password), digest(body.code)],
    );
    return { email: owner.email, token: await newSession(tx) };
  });
  cookie(res, out.token);
  return { email: out.email };
}
export function accountRouter() {
  const router = express.Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.get("/", async (_req, res) => {
    const row = (
      await db.query(
        "select email,cardinality(recovery_hashes) as recovery_codes_remaining from kitchen.owner where id=1",
      )
    ).rows[0];
    res.json({ ...row, single_owner: true });
  });
  router.put("/", async (req, res) => {
    const body = z
      .object({
        current_password: z.string().max(256),
        email: z.string().trim().toLowerCase().email(),
        new_password: password.optional(),
      })
      .parse(req.body);
    const token = await transaction(async (tx) => {
      const row = (
        await tx.query("select * from kitchen.owner where id=1 for update")
      ).rows[0];
      if (!(await verifyPassword(body.current_password, row.password_hash)))
        throw new HttpError(403, "הסיסמה הנוכחית אינה נכונה");
      await tx.query(
        "update kitchen.owner set email=$1,password_hash=$2 where id=1",
        [
          body.email,
          body.new_password
            ? await passwordHash(body.new_password)
            : row.password_hash,
        ],
      );
      return newSession(tx);
    });
    cookie(res, token);
    res.json({ email: body.email });
  });
  router.post("/recovery-codes", async (req, res) => {
    const body = z
      .object({ current_password: z.string().max(256) })
      .parse(req.body);
    const codes = await transaction(async (tx) => {
      const row = (
        await tx.query("select * from kitchen.owner where id=1 for update")
      ).rows[0];
      if (!(await verifyPassword(body.current_password, row.password_hash)))
        throw new HttpError(403, "הסיסמה הנוכחית אינה נכונה");
      const codes = Array.from({ length: 8 }, () =>
        randomBytes(32).toString("hex"),
      );
      await tx.query("update kitchen.owner set recovery_hashes=$1 where id=1", [
        codes.map(digest),
      ]);
      return codes;
    });
    res.json({ codes });
  });
  return router;
}
