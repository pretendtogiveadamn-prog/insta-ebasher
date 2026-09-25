// leads CLI — list/add/status (spec 04). handle = exact, побуквенно.
import { randomUUID } from "node:crypto";
import { STATE_DIR, DB_PATH, EVIDENCE_DIR } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { existsSync } from "node:fs";

const USAGE = `usage:
  ih leads list [--status new]
  ih leads add --handle @x [--artist "Name"] [--track "T"] [--source manual] [--beat "bit-name"] [--draft "текст"]
  ih leads draft <leadId|handle> --value "новый текст"   # сменить текст НЕотправленному лиду
  ih leads status <leadId> --value ready|rejected|...`;

export function addLead(db, { handle, artist, track, source, beatRef, draft }) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO leads (id, handle, artist, track, source, beat_ref, draft) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, handle.replace(/^@+/, ""), artist ?? null, track ?? null, source ?? "manual", beatRef ?? null, draft ?? null);
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

export async function cmdLeads(action = "list", id, opts = {}) {
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR);

  if (action === "list") {
    const rows = opts.status
      ? db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY created_at").all(opts.status)
      : db.prepare("SELECT * FROM leads ORDER BY created_at").all();
    if (!rows.length) {
      console.log("лидов нет. add: ih leads add --handle @x --artist \"...\" --track \"...\"");
      return;
    }
    for (const l of rows) {
      console.log(`${l.id.slice(0, 8)} @${l.handle} [${l.status}]${l.artist ? " " + l.artist : ""}${l.dm_worth != null ? ` dm_worth=${l.dm_worth}` : ""}${l.replied ? " replied" : ""}`);
    }
    return;
  }

  if (action === "add") {
    if (!opts.handle) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const l = addLead(db, opts);
    logger({ event: "lead_add", id: l.id, handle: l.handle });
    console.log(`добавлен: ${l.id.slice(0, 8)} @${l.handle} [${l.status}]${l.draft ? " draft ✔" : ""}`);
    return;
  }

  if (action === "draft") {
    if (!id || !opts.value) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const key = String(id ?? "").replace(/^@/, "");
    const l0 = db.prepare("SELECT * FROM leads WHERE id = ? OR substr(id,1,8) = ? OR handle = ?").get(key, key, key);
    if (!l0) {
      console.log(`лид ${key} не найден`);
      process.exitCode = 2;
      return;
    }
    if (l0.status === "sent") {
      console.log(`@${l0.handle} уже отправлен — текст менять поздно (анти-дубль)`);
      process.exitCode = 2;
      return;
    }
    db.prepare("UPDATE leads SET draft = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(opts.value, l0.id);
    logger({ event: "lead_draft_update", id: l0.id, handle: l0.handle });
    console.log(`@${l0.handle} draft обновлён (${opts.value.length} симв.)`);
    return;
  }

  if (action === "status") {
    if (!id || !opts.value) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const key = String(id ?? "").replace(/^@/, "");
    db.prepare("UPDATE leads SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? OR substr(id,1,8) = ? OR handle = ?").run(opts.value, key, key, key);
    const l = db.prepare("SELECT * FROM leads WHERE id = ? OR substr(id,1,8) = ? OR handle = ?").get(key, key, key);
    if (!l) {
      console.log(`лид ${id} не найден`);
      process.exitCode = 2;
      return;
    }
    console.log(`${l.id.slice(0, 8)} @${l.handle} → ${l.status}`);
    return;
  }

  if (action === "evidence") {
    if (!id) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const dir = `${EVIDENCE_DIR}/${id}`;
    console.log(existsSync(dir) ? dir : `evidence пуст: ${dir} (скрины появятся после DM-flow Phase 2)`);
    return;
  }

  console.log(USAGE);
  process.exitCode = 2;
}
