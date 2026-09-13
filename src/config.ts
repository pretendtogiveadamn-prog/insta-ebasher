import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();
const schema = z.object({ HOST: z.string().default("127.0.0.1"), PORT: z.coerce.number().int().positive().default(3100), DATA_DIR: z.string().default("./data"), DRY_RUN: z.string().default("true").transform((v) => v.toLowerCase() === "true"), FIRST_DM_LIMIT_24H: z.coerce.number().int().min(1).max(35).default(35), PHONE_DEFAULT_COUNTRY: z.string().regex(/^\+\d{1,3}$/).default("+1"), TELEGRAM_BOT_TOKEN: z.string().optional().transform((v) => v?.trim() || null), TELEGRAM_CHAT_ID: z.string().optional().transform((v) => v?.trim() || null) });
export type Config = { host: string; port: number; db: string; dryRun: boolean; limit: number; country: string; telegram: { token: string | null; chatId: string | null } };
export function config(): Config { const e = schema.parse(process.env); if (!["127.0.0.1", "localhost", "::1"].includes(e.HOST)) throw new Error("INSTA-EBASHER is local-only"); const dir = resolve(process.cwd(), e.DATA_DIR); mkdirSync(dir, { recursive: true }); return { host: e.HOST, port: e.PORT, db: resolve(dir, "insta-ebasher.sqlite"), dryRun: e.DRY_RUN, limit: e.FIRST_DM_LIMIT_24H, country: e.PHONE_DEFAULT_COUNTRY, telegram: { token: e.TELEGRAM_BOT_TOKEN, chatId: e.TELEGRAM_CHAT_ID } }; }
