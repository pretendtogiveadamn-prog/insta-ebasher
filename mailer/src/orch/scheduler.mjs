// Один прогон аккаунта: до N DM с интервалами (dry-run — интервалы пропускаем).
// spec 08: attach ОДИН раз на батч — вкладка живёт между DM, кд проводим на ленте (scroll).
import { make, fromUnknown } from "../core/errors.mjs";
import { nextDelaySecs } from "./limits.mjs";
import { runDmFlow, precheck, cooldownOnFeed } from "../flows/dm.mjs";
import { makeAttach } from "../browser/attach-chrome.mjs";
import { cooldownAccount, isCooldownActive } from "./accounts.mjs";
import { cooldownHours, cooldownUntil } from "./limits.mjs";
import { saveEvidence } from "../core/evidence.mjs";
import { attachProfile } from "../browser/attach.mjs";
import { Humanizer } from "../browser/human.mjs";
import { randomUUID } from "node:crypto";

// claim: следующий ready-лид, чей handle ещё не обрабатывался (sent) этим аккаунтом.
// Статус НЕ меняем (остаётся ready — precheck требует ready); закрепляем только account_id.
export function claimNextLead(db, accountId) {
  const lead = db
    .prepare(
      `SELECT l.* FROM leads l
       WHERE l.status = 'ready'
         AND (l.account_id IS NULL OR l.account_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM outreach_log o
           JOIN leads ol ON ol.id = o.lead_id
           WHERE ol.handle = l.handle AND o.account_id = ? AND o.outcome = 'sent'
         )
       ORDER BY l.created_at LIMIT 1`
    )
    .get(accountId, accountId);
  if (lead) {
    db.prepare("UPDATE leads SET account_id = ?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(accountId, lead.id);
  }
  return lead ?? null;
}

// Регистрация outcome в outreach_log + статус лида (spec 02 failure policy)
export function recordOutcome(db, { accountId, leadId, outcome, dryRun = 0, step = null, evidenceDir = null }) {
  db.prepare(
    "INSERT INTO outreach_log (account_id, lead_id, outcome, dry_run, step, evidence_dir) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(accountId, leadId, outcome, dryRun ? 1 : 0, step, evidenceDir);
}

const LEAD_STATUS_BY_ERROR = {
  RecipientResolutionError: "failed_exact",
  ConfirmMissError: "needs_manual",
  DmRestrictedError: "dm_restricted",
  ActionBlockError: "pending",
  SessionError: "pending",
  ProxyError: "pending",
  CaptchaError: "needs_manual",
  LlmError: "llm_failed",
};

export function applyFailure(db, { accountId, lead, err }) {
  const code = err?.code ?? "TransientError";
  recordOutcome(db, { accountId, leadId: lead.id, outcome: outcomeForError(code), step: err.step });
  const status = LEAD_STATUS_BY_ERROR[code] ?? "needs_manual";
  db.prepare("UPDATE leads SET status=?, last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(
    status,
    `${code}: ${err.message}`.slice(0, 300),
    lead.id
  );
  // cooldown аккаунта по severity (spec 02/04): action_block → 4/24/72h по счётчику; captcha timeout → 24h
  if (code === "ActionBlockError") {
    const count = actionBlockCount(db, accountId) + 1;
    cooldownAccount(db, accountId, cooldownUntil(cooldownHours(count)), `action_block #${count}`);
  } else if (code === "CaptchaError") {
    cooldownAccount(db, accountId, cooldownUntil(24), "captcha_timeout");
  }
  return { status, code };
}

function outcomeForError(code) {
  return {
    RecipientResolutionError: "recipient_error",
    ConfirmMissError: "confirm_miss",
    DmRestrictedError: "dm_restricted",
    ActionBlockError: "action_block",
    SessionError: "login_required",
    ProxyError: "no_result",
    CaptchaError: "captcha",
    LlmError: "no_result",
  }[code] ?? "no_result";
}

// cooldown аккаунта по ActionBlockError (severity-счётчик по outreach_log за 7д)
export function actionBlockCount(db, accountId, days = 7) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return db.prepare("SELECT COUNT(*) n FROM outreach_log WHERE account_id=? AND outcome='action_block' AND sent_at >= ?").get(accountId, since).n;
}

// Один прогон аккаунта: до N DM с интервалами (dry-run — интервалы IH_TIME_SCALE-сжаты)
export async function runAccountBatch({
  db,
  account,
  client,
  profileId,
  dryRun = true,
  maxSends = 3,
  onlyLeadId = null, // точечный лид (ih send --lead-id): батч обслуживает только его
  canary = false, // первый live-прогон: send-confirm ещё не verified — bootstrap (spec 06)
  logger = () => {},
  stateDir,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  deps = {},
}) {
  // свежий снапшот аккаунта: cooldown/cap могли обновиться в прошлой итерации
  const freshAccount = () => db.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id) ?? account;
  const flow = deps.dmFlow ?? runDmFlow;
  const human = deps.human ?? new Humanizer();
  const results = [];
  let attached = null; // { page, browser } — один attach на батч (spec 08: кд на ленте, вкладка живая)
  try {
    for (let i = 0; i < maxSends; i++) {
      let sentThisRound = false;
      account = freshAccount();
      if (isCooldownActive(account)) {
        logger({ event: "batch_cooldown", account: account.id, until: account.cooldown_until });
        break;
      }
      const lead = onlyLeadId
        ? (db.prepare("SELECT * FROM leads WHERE id = ? OR substr(id,1,8) = ?").get(onlyLeadId, onlyLeadId) ?? null)
        : claimNextLead(db, account.id);
      if (!lead) {
        logger({ event: "batch_no_leads", account: account.id, onlyLeadId });
        break;
      }
      try {
        // precheck spec 02 — обязательный gate перед machine (cap/cooldown/ready/contract-gate).
        // Аккаунт-левел фейл (cap/disabled/cooldown) — без записи на лид, просто стоп.
        try {
          precheck({ db, account, lead, mode: dryRun ? "dry_run" : "live", canary });
        } catch (pe) {
          logger({ event: "batch_precheck_fail", account: account.id, error: pe.code ?? String(pe), message: pe.message });
          // лид-левел фейл (нет draft/handle — LlmError) → не крутиться на нём бесконечно
          if (pe?.code === "LlmError") {
            applyFailure(db, { accountId: account.id, lead, err: pe });
            continue;
          }
          break; // аккаунт-левел (cap/disabled/cooldown/contract-gate) — стоп
        }
        if (!attached) {
          try {
            attached = await (deps.attachProfile ?? makeAttach() ?? attachProfile)(client, profileId, { newTabUrl: "https://www.instagram.com/" });
          } catch (ae) {
            // браузер не поднялся/клиент закрыл окно — лид НЕ виноват: стоп батча, лид остаётся ready
            logger({ event: "batch_attach_fail", account: account.id, error: String(ae?.message ?? ae).slice(0, 200) });
            results.push({ lead: lead.id, outcome: "attach_failed" });
            break;
          }
        }
        const res = await flow({
          client,
          profileId,
          account,
          lead,
          db,
          logger,
          stateDir,
          dryRun,
          canary,
          page: attached.page,
          browser: attached.browser,
          human,
        });
        if (res.skipped === "duplicate") {
          // наш текст уже в переписке — лид фактически contacted ранее, повторно не шлём
          recordOutcome(db, { accountId: account.id, leadId: lead.id, outcome: "skipped_duplicate", dryRun, step: "S6_compose" });
          db.prepare("UPDATE leads SET status='sent', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(lead.id);
          results.push({ lead: lead.id, outcome: "skipped_duplicate" });
        } else if (res.dryRun) {
          recordOutcome(db, { accountId: account.id, leadId: lead.id, outcome: "dry_run", dryRun: true, step: res.steps.at(-1) });
          // dry-run не должен «съедать» лид: возвращаем в ready, снимаем закрепление
          db.prepare("UPDATE leads SET status='ready', account_id=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(lead.id);
          results.push({ lead: lead.id, outcome: "dry_run" });
        } else {
          recordOutcome(db, { accountId: account.id, leadId: lead.id, outcome: "sent", step: "S10_log" });
          db.prepare("UPDATE leads SET status='sent', sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(lead.id);
          db.prepare("UPDATE accounts SET last_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(account.id);
          results.push({ lead: lead.id, outcome: "sent" });
          sentThisRound = true;
        }
      } catch (e) {
        const typed = fromUnknown(e, { leadId: lead.id, accountId: account.id });
        // вкладку/окно закрыли посреди дела → следующий лид пере-attach'нется (не жжём остальные)
        if (/target.*closed|browser.*closed|connection.*closed|page.*crashed/i.test(String(typed.message ?? ""))) {
          logger({ event: "batch_tab_lost", lead: lead.id });
          attached = null;
        }
        const { status, code } = applyFailure(db, { accountId: account.id, lead, err: typed });
        results.push({ lead: lead.id, outcome: code, status });
        if (code === "ActionBlockError" || code === "ProxyError" || code === "SessionError" || code === "CaptchaError") {
          logger({ event: "batch_stop", account: account.id, reason: code });
          break; // fail-closed: стоп аккаунта
        }
      }
      // FEED_COOLDOWN между DM (spec 08): успех → 3–6 мин на ленте со скроллом;
      // фейл (не отписал) → ~2 мин и продолжаем (owner 2026-09-25). После последнего не нужен.
      if (!dryRun && i + 1 < maxSends && attached?.page) {
        const delay = sentThisRound ? nextDelaySecs() : 105 + Math.floor(Math.random() * 31);
        logger({ event: "batch_feed_cooldown", secs: Math.round(delay), after: sentThisRound ? "sent" : "fail" });
        await cooldownOnFeed(attached.page, human, delay, { sleepFn, logger });
      }
    }
  } finally {
    if (attached) {
      await attached.page?.close().catch(() => {});
      await attached.browser?.close().catch(() => {}); // рвём CDP-коннект; Chrome панели живёт
    }
  }
  return results;
}
