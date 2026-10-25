// mailer.mjs — рассылка по lease-протоколу v1 (ADR: v2 = движок поверх v1).
// Цикл: heartbeat → state → outreach-lease (v1 выбирает ЦЕЛЬ и ТЕКСТ) → dm-flow → outcome.
// Fail-closed гейты v2 сохранены: IH_CLASSIFY_ONLY, cooldown, daily_cap, verified-контракты (в dm-flow).
import { runDmFlow } from "../flows/dm.mjs";
import { recordOutcome, applyFailure } from "./scheduler.mjs";
import { isCooldownActive } from "./accounts.mjs";
import { sentToday, nextDelaySecs } from "./limits.mjs";
import { outcomeForV1, isNaturalStop } from "../bridge/v1.mjs";
import { make } from "../core/errors.mjs";

const HEARTBEAT_MS = 60_000; // v1 требует freshness < 90s
// watchdog на один DM: зависший Anty/CDP не должен вешать рассылку навсегда (lease протухает)
const DM_TIMEOUT_MS = Number(process.env.IH_DM_TIMEOUT_MS ?? 8 * 60 * 1000);

// гонка с таймаутом: при срабатывании — ConfirmMissError (мы НЕ знаем, ушло ли → v1 uncertain,
// лид в unknown, повторно не выдастся — анти-дубль). Зависший dmFlow доживает фоном: его finally
// закроет браузер; дубль-DM исключён v1-стороной.
function withTimeout(promise, ms, makeErr) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(makeErr()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// outcome в v1 — критично (потеря = lease висит active → след. запуск стопается). Retry с backoff;
// при полном фейле — событие mailer_outcome_lost (в events + jsonl) для ручного replay.
async function postOutcomeRetry(v1, leaseId, payload, { attempts = 3, sleepFn, logger } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      await v1.postOutcome(leaseId, payload);
      return true;
    } catch (e) {
      logger({ event: "mailer_outcome_retry", lease: leaseId, attempt: i + 1, error: String(e?.v1Message ?? e?.message ?? e) });
      if (i + 1 < attempts) await sleepFn(1000 * 2 ** i);
    }
  }
  logger({ event: "mailer_outcome_lost", lease: leaseId, payload });
  return false;
}

// зеркало v1-лида в v2 DB: outreach_log.lead_id + draft (текст из lease) для dm-flow
export function upsertLeaseLead(db, { leadId, handle, message }) {
  db.prepare(
    `INSERT INTO leads (id, handle, status, draft) VALUES (?, ?, 'new', ?)
     ON CONFLICT(handle) DO UPDATE SET draft = excluded.draft,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(`v1-${leadId}`, handle, message);
  return db.prepare("SELECT * FROM leads WHERE handle = ?").get(handle);
}

export function bindV1Account(db, accountId, v1AccountId) {
  db.prepare("UPDATE accounts SET v1_account_id = ? WHERE id = ?").run(v1AccountId, accountId);
}

// heartbeat-луп параллельно dm-flow (Node-таймеры работают между await): v1 видит свежий available
export function startHeartbeat(v1, { v1AccountId, username, intervalMs = HEARTBEAT_MS, logger = () => {} }) {
  let stopped = false;
  const beat = async () => {
    if (stopped) return;
    try {
      await v1.heartbeat(v1AccountId, "available", username);
    } catch (e) {
      logger({ event: "mailer_heartbeat_fail", error: String(e?.v1Message ?? e?.message ?? e) });
    }
  };
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();
  const first = beat();
  return {
    ready: first,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      return first;
    },
  };
}

export async function runMailer({
  db,
  client, // AntyClient
  account, // строка v2-аккаунта (anty_profile_id, daily_cap, username, v1_account_id)
  v1, // V1Bridge
  logger = () => {},
  stateDir,
  maxSends = 10,
  forceDryRun = false,
  canary = false,
  dmTimeoutMs = DM_TIMEOUT_MS,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  dmFlow = runDmFlow,
}) {
  const results = [];
  let stopped = "completed";
  let v1AccountId = account.v1_account_id ?? null;

  if (!v1AccountId) {
    const label = `mailer:${account.username ?? account.label ?? account.id.slice(0, 8)}`;
    const v1Account = await v1.ensureAccount(label);
    v1AccountId = v1Account.id;
    bindV1Account(db, account.id, v1AccountId);
    logger({ event: "mailer_v1_account", v1AccountId, label });
  }

  if (canary) maxSends = Math.min(maxSends, 1); // канарей = строго один DM

  const hb = startHeartbeat(v1, { v1AccountId, username: account.username ?? null, logger });
  const freshAccount = () => db.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id) ?? account;

  try {
    await hb.ready;
    for (let i = 0; i < maxSends; i++) {
      const acc = freshAccount();
      if (isCooldownActive(acc)) {
        stopped = `cooldown:${acc.cooldown_reason ?? ""}`;
        break;
      }
      const { sent, cap } = sentToday(db, acc.id, new Date(), acc.daily_cap);
      if (sent >= cap) {
        stopped = `v2_cap:${sent}/${cap}`;
        break;
      }

      // state-гейт v1 (fail-closed)
      let state;
      try {
        state = await v1.getState();
      } catch (e) {
        stopped = `state_error:${String(e?.v1Message ?? e?.message).slice(0, 80)}`;
        break;
      }
      if (state.stopReason) {
        stopped = `v1_stop:${state.stopReason}`;
        break;
      }
      if (state.mode === "blocked") {
        stopped = "v1_blocked";
        break;
      }
      if (!state.quota?.firstDmRemaining) {
        stopped = "v1_quota";
        break;
      }
      if (!state.activeCampaignId) {
        stopped = "v1_no_campaign";
        break;
      }
      if (state.activeLease) {
        stopped = "v1_active_lease";
        break;
      }

      // lease: v1 сам выбирает цель и рендерит текст
      let lease;
      try {
        lease = await v1.takeOutreachLease(v1AccountId);
      } catch (e) {
        const msg = String(e?.v1Message ?? e?.message);
        stopped = isNaturalStop(e) ? `v1_natural:${msg.slice(0, 80)}` : `v1_lease_error:${msg.slice(0, 80)}`;
        break;
      }

      const target = lease.payload?.target ?? {};
      if (!target.handle || !target.message || !target.leadId) {
        stopped = "v1_lease_bad_payload";
        break;
      }

      // TTL lease: DM-флоу занимает минуты (dwell/typing) — стартовать с протухающим lease нельзя
      const leaseTtlMs = Date.parse(lease.expiresAt ?? "") - Date.now();
      if (Number.isFinite(leaseTtlMs) && leaseTtlMs < 60_000) {
        logger({ event: "mailer_lease_ttl_short", lease: lease.id, ttlMs: leaseTtlMs });
        await postOutcomeRetry(v1, lease.id, { outcome: "not_sent", observedHandle: target.handle }, { sleepFn, logger });
        stopped = "v1_lease_ttl_short";
        break;
      }

      const dryRun = Boolean(forceDryRun || (lease.dryRun ?? lease.payload?.dryRun));

      // live fail-closed: IH_CLASSIFY_ONLY=1 (дефолт) запрещает live-отправку (spec 03)
      if (!dryRun && String(process.env.IH_CLASSIFY_ONLY ?? "1") === "1") {
        stopped = "ih_classify_only";
        await postOutcomeRetry(v1, lease.id, { outcome: "not_sent", observedHandle: target.handle }, { sleepFn, logger });
        break;
      }

      const lead = upsertLeaseLead(db, target);
      logger({ event: "mailer_lease", lease: lease.id, handle: target.handle, dryRun, expiresAt: lease.expiresAt });

      try {
        const res = await withTimeout(
          dmFlow({
            client,
            profileId: acc.anty_profile_id,
            account: acc,
            lead,
            db,
            logger,
            stateDir,
            dryRun,
            canary,
          }),
          dmTimeoutMs,
          () => make("ConfirmMissError", `dm watchdog: флоу не завершился за ${dmTimeoutMs}ms — состояние отправки неизвестно`, { step: "watchdog", leadId: lead.id })
        );

        if (res.dryRun) {
          recordOutcome(db, { accountId: acc.id, leadId: lead.id, outcome: "dry_run", dryRun: true, step: res.steps?.at(-1) });
          await postOutcomeRetry(v1, lease.id, { outcome: "previewed", observedHandle: target.handle }, { sleepFn, logger });
          results.push({ handle: target.handle, outcome: "previewed" });
        } else {
          recordOutcome(db, { accountId: acc.id, leadId: lead.id, outcome: "sent", step: "S10_log" });
          db.prepare(
            "UPDATE leads SET status='sent', sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
          ).run(lead.id);
          db.prepare("UPDATE accounts SET last_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(acc.id);
          await postOutcomeRetry(v1, lease.id, { outcome: "sent", observedHandle: target.handle }, { sleepFn, logger });
          results.push({ handle: target.handle, outcome: "sent" });
        }
      } catch (e) {
        const typed = e?.code ? e : make("TransientError", String(e?.message ?? e));
        const v1Out = outcomeForV1(typed.code);
        await postOutcomeRetry(v1, lease.id, { outcome: v1Out, observedHandle: target.handle }, { sleepFn, logger });
        applyFailure(db, { accountId: acc.id, lead, err: typed });
        // сигнал в v1-панель о состоянии «Chrome-агента»
        if (typed.code === "SessionError") {
          await v1.heartbeat(v1AccountId, "login_required", acc.username ?? null).catch(() => {});
        }
        if (typed.code === "ActionBlockError" || typed.code === "DmRestrictedError") {
          await v1.heartbeat(v1AccountId, "restricted", acc.username ?? null).catch(() => {});
        }
        results.push({ handle: target.handle, outcome: v1Out, code: typed.code });
        if (["ActionBlockError", "ProxyError", "SessionError", "CaptchaError"].includes(typed.code)) {
          stopped = `fail_closed:${typed.code}`;
          break;
        }
      }

      // хвостовой слип не нужен: после последней итерации спим зря
      if (i + 1 < maxSends) {
        const delayMs = Math.round(nextDelaySecs() * 1000);
        logger({ event: "mailer_delay", ms: delayMs });
        await sleepFn(delayMs);
      }
    }
  } finally {
    await hb.stop().catch(() => {});
  }

  return { results, stopped };
}
