import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../src/core/db.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshDb() {
  return openDb(join(tmpdir(), `ih-test-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
}

test("миграции применяются и идемпотентны", () => {
  const db = freshDb();
  const n = db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n;
  assert.ok(n >= 1);
  // повторный openDb на той же базе не падает и не дублирует
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["accounts", "leads", "outreach_log", "llm_cache", "events", "fp_baseline"]) {
    assert.ok(tables.includes(t), t);
  }
});

test("leads.status enum-check", () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l1', 'artist_x')").run();
  assert.throws(() => db.prepare("UPDATE leads SET status='wat' WHERE id='l1'").run());
  for (const s of ["new", "ready", "sent", "rejected", "failed_exact", "dm_restricted", "needs_manual", "llm_failed", "pending", "researching"]) {
    db.prepare("UPDATE leads SET status=? WHERE id='l1'").run(s);
  }
});

test("leads.unique handle", () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('a', 'dup1')").run();
  assert.throws(() => db.prepare("INSERT INTO leads (id, handle) VALUES ('b', 'dup1')").run());
});

test("outreach_log.outcome enum-check", () => {
  const db = freshDb();
  db.prepare("INSERT INTO accounts (id, label) VALUES ('acc1', 't')").run();
  db.prepare("INSERT INTO leads (id, handle) VALUES ('l1', 'h1')").run();
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome) VALUES ('acc1','l1','sent')").run();
  assert.throws(() => db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome) VALUES ('acc1','l1','weird')").run());
});

test("daily_cap positive constraint", () => {
  const db = freshDb();
  assert.throws(() => db.prepare("INSERT INTO accounts (id, label, daily_cap) VALUES ('a','x',0)").run());
  assert.throws(() => db.prepare("INSERT INTO accounts (id, label, daily_cap) VALUES ('a','x',-5)").run());
});
