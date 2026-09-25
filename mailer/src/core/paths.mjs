// paths.mjs — единственный источник путей репо
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // src/core
export const ROOT = join(HERE, "..", "..");
export const STATE_DIR = join(ROOT, "state");
export const DB_PATH = join(STATE_DIR, "insta-ebasher-v2.db");
export const LOGS_DIR = join(STATE_DIR, "logs");
export const EVIDENCE_DIR = join(STATE_DIR, "evidence");
