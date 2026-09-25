// accounts.mjs — CRUD accounts (spec 04): list/add/pause/cap.
import { randomUUID } from "node:crypto";

export function listAccounts(db, { includeDisabled = true } = {}) {
  const rows = db
    .prepare(includeDisabled ? "SELECT * FROM accounts ORDER BY created_at" : "SELECT * FROM accounts WHERE enabled = 1 ORDER BY created_at")
    .all();
  return rows;
}

export function getAccount(db, id) {
  return db.prepare("SELECT * FROM accounts WHERE id = ? OR substr(id,1,8) = ?").get(id, id);
}

export function addAccount(db, { id = randomUUID(), label, antyProfileId, username, proxyNote, dailyCap = 25 }) {
  db.prepare(
    "INSERT INTO accounts (id, label, anty_profile_id, username, proxy_note, daily_cap) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, label ?? null, antyProfileId, username ?? null, proxyNote ?? null, dailyCap);
  return getAccount(db, id);
}

export function pauseAccount(db, id, enabled) {
  db.prepare("UPDATE accounts SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0);
  return getAccount(db, id);
}

export function setCap(db, id, cap) {
  db.prepare("UPDATE accounts SET daily_cap = ? WHERE id = ?").run(cap);
  return getAccount(db, id);
}

export function cooldownAccount(db, id, untilIso, reason) {
  db.prepare("UPDATE accounts SET cooldown_until = ?, cooldown_reason = ? WHERE id = ?").run(untilIso, reason, id);
}

export function isCooldownActive(account, now = new Date()) {
  if (!account?.cooldown_until) return false;
  return new Date(account.cooldown_until) > now;
}
