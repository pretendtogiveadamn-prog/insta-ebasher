// SQLite state — spec 04. Numbered migrations in migrations/ (idempotent).
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function ensureSchemaTable(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (num INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
}

export function migrate(db) {
  ensureSchemaTable(db);
  const applied = new Set(
    db.prepare("SELECT num FROM schema_migrations").all().map((r) => r.num)
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const num = Number(file.slice(0, 3));
    if (applied.has(num)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (num, name) VALUES (?, ?)").run(num, file);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }
  return files.length;
}
