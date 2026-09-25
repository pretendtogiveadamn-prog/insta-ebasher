import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../src/core/db.mjs";
import { addAccount, getAccount, isCooldownActive } from "../../src/orch/accounts.mjs";
import { runMailer, upsertLeaseLead, startHeartbeat, bindV1Account } from "../../src/orch/mailer.mjs";
import { make } from "../../src/core/errors.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freshDb() {
  const db = openDb(join(tmpdir(), `ih-mail-${Date.now()}-${Math.random().toString(36).slice(2)}/t.db`));
  addAccount(db, { id: "acc1", antyProfileId: "p1", username: "mailer-test" });
  return db;
}

// fake v1-бэкенд: state/lease/outcome/heartbeat по сценарию
function fakeV1(overrides = {}) {
  const calls = { heartbeats: [], outcomes: [], leases: 0 };
  let n = 0;
  let outcomeFails = overrides.postOutcomeFailBefore ?? 0;
  const v1 = {
    async getState() {
      return (
        overrides.state?.(n) ?? {
          mode: "dry_run",
          chrome: "available",
          stopReason: null,
          quota: { firstDmRemaining: 5, windowEndsAt: null },
          activeCampaignId: "c1",
          activeLease: null,
        }
      );
    },
    async heartbeat(accountId, chromeState, username) {
      calls.heartbeats.push({ accountId, chromeState, username });
      return {};
    },
    async ensureAccount() {
      return { id: "v1acc", label: "mailer:mailer-test" };
    },
    async takeOutreachLease() {
      calls.leases++;
      n++;
      if (overrides.leaseError) {
        const e = new Error(overrides.leaseError);
        e.v1Message = overrides.leaseError;
        throw e;
      }
      const dryRun = overrides.leaseDryRun ?? true;
      return {
        id: `lease-${n}`,
        type: "outreach",
        expiresAt: overrides.leaseExpiresAt ?? new Date(Date.now() + 300000).toISOString(),
        dryRun,
        payload: { target: { leadId: `l${n}`, handle: `artist${n}`, message: `hi ${n}` }, quota: {}, dryRun },
      };
    },
    async postOutcome(leaseId, body) {
      calls.outcomes.push({ leaseId, ...body });
      if (outcomeFails-- > 0) throw new Error("v1 500 boom");
      return {};
    },
  };
  v1.calls = calls;
  return v1;
}

const dmOk = (dryRun) => async () => ({ ok: true, dryRun, steps: ["S0_attach", "S10_log"] });
const dmFail = (code, message = "x") => async () => {
  throw make(code, message, { step: "S5" });
};

const baseOpts = (over = {}) => ({
  client: { profile: () => ({}) },
  stateDir: join(tmpdir(), "ih-mail-test"),
  maxSends: 1,
  sleepFn: async () => {},
  ...over,
});

test("runMailer: dry-run happy path → previewed в v1, dry_run в v2-логе, mirror-лид", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  const acc = getAccount(db, "acc1");
  const out = await runMailer({ ...baseOpts(), db, account: acc, v1, dmFlow: dmOk(true) });

  assert.equal(out.stopped, "completed");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].outcome, "previewed");
  assert.deepEqual(v1.calls.outcomes, [{ leaseId: "lease-1", outcome: "previewed", observedHandle: "artist1" }]);

  const lead = db.prepare("SELECT * FROM leads WHERE handle='artist1'").get();
  assert.equal(lead.draft, "hi 1");
  const log = db.prepare("SELECT * FROM outreach_log WHERE lead_id=?").get(lead.id);
  assert.equal(log.outcome, "dry_run");
  assert.equal(log.dry_run, 1);
  // v1-аккаунт забиндился
  assert.equal(getAccount(db, "acc1").v1_account_id, "v1acc");
});

test("runMailer: live sent → sent в v1 (observedHandle), v2 статус лида sent, last_sent_at", async () => {
  const prev = process.env.IH_CLASSIFY_ONLY;
  process.env.IH_CLASSIFY_ONLY = "0";
  try {
    const db = freshDb();
    const v1 = fakeV1({ leaseDryRun: false, state: () => ({ mode: "live_enabled", chrome: "available", stopReason: null, quota: { firstDmRemaining: 5 }, activeCampaignId: "c1", activeLease: null }) });
    const acc = getAccount(db, "acc1");
    const out = await runMailer({ ...baseOpts(), db, account: acc, v1, dmFlow: dmOk(false) });

    assert.equal(out.results[0].outcome, "sent");
    assert.deepEqual(v1.calls.outcomes, [{ leaseId: "lease-1", outcome: "sent", observedHandle: "artist1" }]);
    const lead = db.prepare("SELECT * FROM leads WHERE handle='artist1'").get();
    assert.equal(lead.status, "sent");
    assert.ok(lead.sent_at);
    assert.ok(getAccount(db, "acc1").last_sent_at);
    const log = db.prepare("SELECT * FROM outreach_log WHERE lead_id=?").get(lead.id);
    assert.equal(log.outcome, "sent");
    assert.equal(log.dry_run, 0);
  } finally {
    if (prev === undefined) delete process.env.IH_CLASSIFY_ONLY;
    else process.env.IH_CLASSIFY_ONLY = prev;
  }
});

test("runMailer: live при IH_CLASSIFY_ONLY=1 → fail-closed, not_sent в v1, dm не запускался", async () => {
  const prev = process.env.IH_CLASSIFY_ONLY;
  delete process.env.IH_CLASSIFY_ONLY;
  try {
    const db = freshDb();
    const v1 = fakeV1({ leaseDryRun: false, state: () => ({ mode: "live_enabled", chrome: "available", stopReason: null, quota: { firstDmRemaining: 5 }, activeCampaignId: "c1", activeLease: null }) });
    let dmCalled = 0;
    const out = await runMailer({
      ...baseOpts(),
      db,
      account: getAccount(db, "acc1"),
      v1,
      dmFlow: async () => {
        dmCalled++;
        return { ok: true, dryRun: false, steps: [] };
      },
    });
    assert.equal(out.stopped, "ih_classify_only");
    assert.equal(dmCalled, 0);
    assert.deepEqual(v1.calls.outcomes, [{ leaseId: "lease-1", outcome: "not_sent", observedHandle: "artist1" }]);
  } finally {
    if (prev !== undefined) process.env.IH_CLASSIFY_ONLY = prev;
  }
});

test("runMailer: forceDryRun глушит live-lease (previewed, а не sent)", async () => {
  const prev = process.env.IH_CLASSIFY_ONLY;
  process.env.IH_CLASSIFY_ONLY = "0";
  try {
    const db = freshDb();
    const v1 = fakeV1({ leaseDryRun: false, state: () => ({ mode: "live_enabled", chrome: "available", stopReason: null, quota: { firstDmRemaining: 5 }, activeCampaignId: "c1", activeLease: null }) });
    const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true), forceDryRun: true });
    assert.equal(out.results[0].outcome, "previewed");
  } finally {
    if (prev === undefined) delete process.env.IH_CLASSIFY_ONLY;
    else process.env.IH_CLASSIFY_ONLY = prev;
  }
});

test("runMailer: stop-условия v1 (quota/stopReason/нет кампании/activeLease)", async () => {
  const cases = [
    { quota: { firstDmRemaining: 0 } },
    { stopReason: "heartbeat_stale" },
    { activeCampaignId: null },
    { activeLease: "someone" },
  ];
  for (const quotaOver of cases) {
    const db = freshDb();
    const state = () => ({ mode: "dry_run", chrome: "available", stopReason: null, quota: { firstDmRemaining: 5, windowEndsAt: null }, activeCampaignId: "c1", activeLease: null, ...quotaOver });
    const v1 = fakeV1({ state });
    let dmCalled = 0;
    const out = await runMailer({
      ...baseOpts(),
      db,
      account: getAccount(db, "acc1"),
      v1,
      dmFlow: async () => {
        dmCalled++;
        return { ok: true, dryRun: true, steps: [] };
      },
    });
    assert.equal(out.results.length, 0);
    assert.equal(dmCalled, 0);
    assert.ok(out.stopped.startsWith("v1_"));
  }
});

test("runMailer: ActionBlock → v1 failed, cooldown аккаунта, fail-closed стоп", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmFail("ActionBlockError", "blocked") });

  assert.equal(out.stopped, "fail_closed:ActionBlockError");
  assert.equal(out.results[0].outcome, "failed");
  assert.deepEqual(v1.calls.outcomes, [{ leaseId: "lease-1", outcome: "failed", observedHandle: "artist1" }]);
  const acc = getAccount(db, "acc1");
  assert.ok(isCooldownActive(acc));
  // heartbeat-сигнал restricted ушёл в v1
  assert.ok(v1.calls.heartbeats.some((h) => h.chromeState === "restricted"));
});

test("runMailer: ConfirmMiss → v1 uncertain, продолжение цикла (не fail-closed)", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  let n = 0;
  const out = await runMailer({
    ...baseOpts({ maxSends: 2 }),
    db,
    account: getAccount(db, "acc1"),
    v1,
    dmFlow: async () => {
      n++;
      if (n === 1) throw make("ConfirmMissError", "нет подтверждения");
      return { ok: true, dryRun: true, steps: [] };
    },
  });
  assert.equal(out.stopped, "completed");
  assert.equal(v1.calls.outcomes[0].outcome, "uncertain");
  assert.equal(v1.calls.outcomes[1].outcome, "previewed");
  const lead = db.prepare("SELECT * FROM leads WHERE handle='artist1'").get();
  assert.equal(lead.status, "needs_manual");
});

test("runMailer: natural stop по lease-ошибке (No eligible lead)", async () => {
  const db = freshDb();
  const v1 = fakeV1({ leaseError: "No eligible lead" });
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.equal(out.stopped, "v1_natural:No eligible lead");
  assert.equal(out.results.length, 0);
});

test("runMailer: lease-ошибка НЕ-natural → lease_error, стоп", async () => {
  const db = freshDb();
  const v1 = fakeV1({ leaseError: "Database blew up" });
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.ok(out.stopped.startsWith("v1_lease_error"));
});

test("runMailer: SessionError → login_required в v1 + стоп", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmFail("SessionError") });
  assert.equal(out.stopped, "fail_closed:SessionError");
  assert.equal(out.results[0].outcome, "login_required");
  assert.ok(v1.calls.heartbeats.some((h) => h.chromeState === "login_required"));
});

test("runMailer: v2 cap/cooldown стопают до lease", async () => {
  const db = freshDb();
  db.prepare("UPDATE accounts SET cooldown_until=? WHERE id='acc1'").run(new Date(Date.now() + 3600000).toISOString());
  const v1 = fakeV1();
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.ok(out.stopped.startsWith("cooldown"));
  assert.equal(v1.calls.leases, 0);
});

test("runMailer: heartbeat стартует сразу и шлёт available", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.ok(v1.calls.heartbeats.length >= 1);
  assert.equal(v1.calls.heartbeats[0].chromeState, "available");
  assert.equal(v1.calls.heartbeats[0].username, "mailer-test");
});

test("runMailer: canary → maxSends=1 и canary передаётся в dmFlow", async () => {
  const prev = process.env.IH_CLASSIFY_ONLY;
  process.env.IH_CLASSIFY_ONLY = "0";
  try {
    const db = freshDb();
    const v1 = fakeV1({ leaseDryRun: false, state: () => ({ mode: "live_enabled", chrome: "available", stopReason: null, quota: { firstDmRemaining: 5 }, activeCampaignId: "c1", activeLease: null }) });
    let dmCalled = 0, canarySeen = null;
    const out = await runMailer({
      ...baseOpts({ maxSends: 10 }),
      db,
      account: getAccount(db, "acc1"),
      v1,
      canary: true,
      dmFlow: async (args) => {
        dmCalled++;
        canarySeen = args.canary;
        return { ok: true, dryRun: false, steps: [] };
      },
    });
    assert.equal(dmCalled, 1); // не 10 — канарей = 1 DM
    assert.equal(canarySeen, true);
    assert.equal(out.results.length, 1);
  } finally {
    if (prev === undefined) delete process.env.IH_CLASSIFY_ONLY;
    else process.env.IH_CLASSIFY_ONLY = prev;
  }
});

test("upsertLeaseLead: insert → повторный lease того же handle обновляет draft, не плодит строк", () => {
  const db = freshDb();
  const l1 = upsertLeaseLead(db, { leadId: "l9", handle: "artist", message: "v1" });
  assert.equal(l1.id, "v1-l9");
  const l2 = upsertLeaseLead(db, { leadId: "l9", handle: "artist", message: "v2-текст" });
  assert.equal(l2.id, "v1-l9");
  assert.equal(l2.draft, "v2-текст");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM leads WHERE handle='artist'").get().n, 1);
});

test("upsertLeaseLead: handle из v1-ресерча (другой id) — конфликт по handle, draft обновляется", () => {
  const db = freshDb();
  db.prepare("INSERT INTO leads (id, handle, status) VALUES ('own-1', 'artist', 'new')").run();
  const l = upsertLeaseLead(db, { leadId: "l9", handle: "artist", message: "lease text" });
  assert.equal(l.id, "own-1"); // существующая строка осталась своей
  assert.equal(l.draft, "lease text");
});

test("bindV1Account: маппинг сохраняется и переиспользуется", async () => {
  const db = freshDb();
  bindV1Account(db, "acc1", "v1-xyz");
  assert.equal(getAccount(db, "acc1").v1_account_id, "v1-xyz");
  // второй прогон не должен звать ensureAccount
  const v1 = fakeV1();
  let ensured = 0;
  v1.ensureAccount = async () => {
    ensured++;
    return { id: "v1-other" };
  };
  await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.equal(ensured, 0);
});

test("startHeartbeat: интервал дёргается и стопается", async () => {
  let beats = 0;
  const v1 = { heartbeat: async () => beats++ };
  const hb = startHeartbeat(v1, { v1AccountId: "a", username: null, intervalMs: 5, logger: () => {} });
  await new Promise((r) => setTimeout(r, 25));
  hb.stop();
  const atStop = beats;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(atStop >= 1);
  assert.equal(beats, atStop);
});

test("runMailer: dmFlow завис → watchdog → uncertain в v1 (анти-дубль), цикл продолжается", async () => {
  const db = freshDb();
  const v1 = fakeV1();
  let n = 0;
  const out = await runMailer({
    ...baseOpts({ maxSends: 2, dmTimeoutMs: 120 }),
    db,
    account: getAccount(db, "acc1"),
    v1,
    dmFlow: async () => {
      n++;
      if (n === 1) await new Promise(() => {}); // завис навсегда (Anty/CDP wedge)
      return { ok: true, dryRun: true, steps: [] };
    },
  });
  assert.equal(out.stopped, "completed");
  assert.equal(out.results[0].outcome, "uncertain"); // не "failed": не знаем, ушло ли → лид не перевыдастся
  assert.equal(out.results[0].code, "ConfirmMissError");
  assert.equal(out.results[1].outcome, "previewed"); // цикл пошёл дальше
  const lead = db.prepare("SELECT * FROM leads WHERE handle='artist1'").get();
  assert.equal(lead.status, "needs_manual");
});

test("runMailer: postOutcome retry — 2 сбоя сети → 3-я попытка доставила", async () => {
  const db = freshDb();
  const v1 = fakeV1({ postOutcomeFailBefore: 2 });
  const out = await runMailer({ ...baseOpts(), db, account: getAccount(db, "acc1"), v1, dmFlow: dmOk(true) });
  assert.equal(out.stopped, "completed");
  // 3 попытки записаны, финальный — успех (outcome не потерян, lease не повис)
  assert.equal(v1.calls.outcomes.length, 3);
  assert.equal(v1.calls.outcomes.at(-1).outcome, "previewed");
});

test("runMailer: lease с протухшим TTL → not_sent + стоп, dm не запускался", async () => {
  const db = freshDb();
  const v1 = fakeV1({ leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
  let dmCalled = 0;
  const out = await runMailer({
    ...baseOpts(),
    db,
    account: getAccount(db, "acc1"),
    v1,
    dmFlow: async () => {
      dmCalled++;
      return { ok: true, dryRun: true, steps: [] };
    },
  });
  assert.equal(out.stopped, "v1_lease_ttl_short");
  assert.equal(dmCalled, 0);
  assert.equal(v1.calls.outcomes.at(-1).outcome, "not_sent");
});
