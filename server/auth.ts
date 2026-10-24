import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
const scrypt = promisify(rawScrypt);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new HttpError(400, "יש לבחור סיסמה באורך 12–256 תווים");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}
export async function createOwner(db: Db, email: string, password: string) {
  const hash = await passwordHash(password);
  await db.query(
    "insert into kitchen.owner(id,email,password_hash) values(1,$1,$2)",
    [email.trim().toLowerCase(), hash],
  );
}
export function authMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.kitchen_session;
      if (!token) throw new HttpError(401, "יש להתחבר לחשבון הבעלים");
      const result = await db.query(
        "select owner_id from kitchen.sessions where token_hash=$1 and expires_at>now()",
        [digest(token)],
      );
      if (!result.rows.length)
        throw new HttpError(401, "ההתחברות פגה. יש להתחבר שוב");
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const configured = process.env.APP_ORIGIN || "http://localhost:3000";
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if ((origin && origin !== configured) || fetchSite === "cross-site") {
    next(new HttpError(403, "הבקשה הגיעה ממקור שאינו מורשה"));
    return;
  }
  next();
}
export async function login(
  db: Db,
  email: string,
  password: string,
  res: Response,
) {
  const result = await db.query("select * from kitchen.owner where id=1");
  const owner = result.rows[0];
  const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await verifyPassword(password, owner?.password_hash || dummy);
  if (!owner || !valid || owner.email !== email.trim().toLowerCase())
    throw new HttpError(401, "האימייל או הסיסמה אינם נכונים");
  const token = randomBytes(32).toString("hex");
  await db.query(
    "insert into kitchen.sessions(token_hash,owner_id,expires_at) values($1,1,now()+interval '30 days')",
    [digest(token)],
  );
  res.cookie("kitchen_session", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    maxAge: 30 * 86400000,
    path: "/",
  });
  return { email: owner.email };
}
