import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../src/core/db.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cooldownHours, cooldownUntil, sentToday, capReached, nextDelaySecs, DEFAULT_LIMITS } from "../../src/orch/limits.mjs";
import { addAccount, isCooldownActive } from "../../src/orch/accounts.mjs";

function freshDb() {
  return openDb(join(tmpdir(), `ih-test-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
}

test("cooldownHours: soft 4 / hard 24 / repeated 72", () => {
  assert.equal(cooldownHours(1), 4);
  assert.equal(cooldownHours(2), 24);
  assert.equal(cooldownHours(3), 72);
  assert.equal(cooldownHours(10), 72);
});

test("cooldownUntil: через N часов", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  assert.equal(cooldownUntil(4, now), "2026-09-19T16:00:00.000Z");
});

test("sentToday/capReached по outreach_log за UTC-день", () => {
  const db = freshDb();
  addAccount(db, { id: "acc1", antyProfileId: "p1", dailyCap: 2 });
  const now = new Date("2026-09-19T12:00:00Z");
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('acc1','l1','sent',?)").run("2026-09-19T11:00:00Z");
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('acc1','l2','dry_run',?)").run("2026-09-19T11:30:00Z");
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('acc1','l3','sent',?)").run("2026-09-18T11:00:00Z"); // вчера
  const s = sentToday(db, "acc1", now);
  assert.equal(s.sent, 1); // dry_run и вчера не считаются
  const c = capReached(db, db.prepare("SELECT * FROM accounts WHERE id='acc1'").get(), now);
  assert.equal(c.reached, false);
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('acc1','l3','sent',?)").run("2026-09-19T11:45:00Z");
  assert.equal(capReached(db, db.prepare("SELECT * FROM accounts WHERE id='acc1'").get(), now).reached, true);
});

test("nextDelaySecs: в интервале 180-360 (owner 2026-09-25) с jitter ±30%", () => {
  for (let i = 0; i < 50; i++) {
    const d = nextDelaySecs(() => i / 50);
    assert.ok(d >= 180 * 0.7 && d <= 360 * 1.3, `d=${d}`);
  }
});

test("isCooldownActive", () => {
  const acc = { cooldown_until: "2026-09-19T16:00:00.000Z" };
  assert.equal(isCooldownActive(acc, new Date("2026-09-19T12:00:00Z")), true);
  assert.equal(isCooldownActive(acc, new Date("2026-09-19T17:00:00Z")), false);
  assert.equal(isCooldownActive({ cooldown_until: null }), false);
});
