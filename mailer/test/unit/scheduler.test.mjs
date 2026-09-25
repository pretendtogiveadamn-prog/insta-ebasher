import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../src/core/db.mjs";
import { claimNextLead, applyFailure, recordOutcome, actionBlockCount, runAccountBatch } from "../../src/orch/scheduler.mjs";
import { addAccount } from "../../src/orch/accounts.mjs";
import { make } from "../../src/core/errors.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshDb() {
  const db = openDb(join(tmpdir(), `ih-sched-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
  addAccount(db, { id: "acc1", antyProfileId: "p1" });
  return db;
}
const ins = (db, id, handle, status = "ready", createdAt = null) => {
  db.prepare("INSERT INTO leads (id, handle, status, created_at) VALUES (?, ?, ?, ?)").run(id, handle, status, createdAt ?? new Date().toISOString());
};

test("claimNextLead: FIFO по created_at, закрепляет account_id", () => {
  const db = freshDb();
  ins(db, "l1", "a", "ready", "2026-09-19T10:00:00Z");
  ins(db, "l2", "b", "ready", "2026-09-19T09:00:00Z");
  const l = claimNextLead(db, "acc1");
  assert.equal(l.id, "l2");
  const row = db.prepare("SELECT status, account_id FROM leads WHERE id='l2'").get();
  assert.equal(row.status, "ready"); // статус НЕ меняем — precheck требует ready
  assert.equal(row.account_id, "acc1");
});

test("claimNextLead: handle уже sent (лид сброшен в ready) → пропускается", () => {
  const db = freshDb();
  ins(db, "l1", "dup", "ready");
  ins(db, "l2", "unique", "ready");
  const first = claimNextLead(db, "acc1");
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome) VALUES ('acc1', ?, 'sent')").run(first.id);
  db.prepare("UPDATE leads SET status='ready' WHERE id=?").run(first.id); // насильно сбросили
  const next = claimNextLead(db, "acc1");
  assert.equal(next.handle, "unique"); // dup пропущен — уже был sent
});

test("applyFailure: failure policy spec 02", () => {
  const db = freshDb();
  ins(db, "l1", "a", "researching");
  const lead = db.prepare("SELECT * FROM leads WHERE id='l1'").get();
  assert.equal(applyFailure(db, { accountId: "acc1", lead, err: make("RecipientResolutionError", "x") }).status, "failed_exact");
  db.prepare("UPDATE leads SET status='researching' WHERE id='l1'").run();
  assert.equal(applyFailure(db, { accountId: "acc1", lead, err: make("ConfirmMissError", "x") }).status, "needs_manual");
  db.prepare("UPDATE leads SET status='researching' WHERE id='l1'").run();
  assert.equal(applyFailure(db, { accountId: "acc1", lead, err: make("DmRestrictedError", "x") }).status, "dm_restricted");
  db.prepare("UPDATE leads SET status='researching' WHERE id='l1'").run();
  assert.equal(applyFailure(db, { accountId: "acc1", lead, err: make("ActionBlockError", "x") }).status, "pending");
  // outcome в outreach_log
  const outcomes = db.prepare("SELECT outcome FROM outreach_log WHERE account_id='acc1'").all().map((r) => r.outcome);
  assert.deepEqual(outcomes, ["recipient_error", "confirm_miss", "dm_restricted", "action_block"]);
});

test("actionBlockCount за окно", () => {
  const db = freshDb();
  db.prepare("INSERT INTO outreach_log (account_id, lead_id, outcome, sent_at) VALUES ('acc1','l','action_block',?)").run(new Date().toISOString());
  assert.equal(actionBlockCount(db, "acc1"), 1);
  assert.equal(actionBlockCount(db, "acc2"), 0);
});

test("claimNextLead: нет ready-лидов → null", () => {
  const db = freshDb();
  assert.equal(claimNextLead(db, "acc1"), null);
});

test("runAccountBatch: onlyLeadId — шлём ТОЛЬКО указанный лид, не первый из очереди", async () => {
  const db = freshDb();
  ins(db, "l1", "first_artist", "ready", "2026-09-19T09:00:00Z");
  ins(db, "l2", "second_artist", "ready", "2026-09-19T10:00:00Z");
  db.prepare("UPDATE leads SET draft='hey' WHERE id IN ('l1','l2')").run();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const flown = [];
  const results = await runAccountBatch({
    db,
    account,
    client: null,
    profileId: "p1",
    dryRun: true,
    maxSends: 1,
    onlyLeadId: "l2",
    logger: () => {},
    stateDir: join(tmpdir(), "ih-sched-batch"),
    sleepFn: async () => {},
    deps: {
      dmFlow: async ({ lead }) => {
        flown.push(lead.id);
        return { ok: true, dryRun: true, steps: ["S7_dry_run_stop"] };
      },
      attachProfile: async () => ({ page: null, browser: null }),
    },
  });
  assert.deepEqual(flown, ["l2"]); // НЕ l1
  assert.equal(results[0].outcome, "dry_run");
});

test("runAccountBatch: attach не удался (клиент закрыл Chrome) → лид НЕ сгорает, батч стоп", async () => {
  const db = freshDb();
  ins(db, "l1", "first_artist", "ready", "2026-09-19T09:00:00Z");
  ins(db, "l2", "second_artist", "ready", "2026-09-19T10:00:00Z");
  db.prepare("UPDATE leads SET draft='hey' WHERE id IN ('l1','l2')").run();
  const account = db.prepare("SELECT * FROM accounts WHERE id='acc1'").get();
  const results = await runAccountBatch({
    db, account, client: null, profileId: "p1", dryRun: false, maxSends: 3,
    logger: () => {}, stateDir: join(tmpdir(), "ih-sched-attach"), sleepFn: async () => {},
    deps: {
      attachProfile: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:9222"); },
      dmFlow: async () => { throw new Error("не должны сюда дойти"); },
    },
  });
  assert.equal(results.length, 1, "батч стопнулся после первой попытки attach");
  assert.equal(results[0].outcome, "attach_failed");
  assert.equal(db.prepare("SELECT status FROM leads WHERE id='l1'").get().status, "ready", "лид остался ready");
  assert.equal(db.prepare("SELECT status FROM leads WHERE id='l2'").get().status, "ready");
});
