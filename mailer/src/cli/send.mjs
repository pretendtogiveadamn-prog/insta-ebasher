// send CLI — DM-flow по лиду (spec 02). Live требует verified контрактов + явного
// owner-запуска; dry-run разрешён с pending-контрактами.
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { getAccount } from "../orch/accounts.mjs";
import { runAccountBatch } from "../orch/scheduler.mjs";
import { AntyClient } from "../browser/anty.mjs";

const USAGE = `usage:
  ih send --lead-id <id> [--dry-run]            один лид
  ih send --account <accountId> --dry-run       батч по аккаунту (до 3 DM)
  ih send --canary <leadId>                     canary: полный флоу до CONFIRM`;

export async function cmdSend(opts = {}) {
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR, {
    sink: (ev) => {
      try {
        db.prepare("INSERT INTO events (level, scope, code, msg, data) VALUES (?, ?, ?, ?, ?)").run(
          ev.error ? "error" : "info", ev.event ?? null, ev.error ?? null, ev.message ?? null, JSON.stringify(ev)
        );
      } catch {}
    },
  });
  const dryRun = Boolean(opts.dryRun);

  // IH_CLASSIFY_ONLY=1 — только классификация, live-отправка запрещена (spec 03)
  if (!dryRun && String(process.env.IH_CLASSIFY_ONLY ?? "1") === "1") {
    console.log("IH_CLASSIFY_ONLY=1 — live-отправка запрещена (spec 03). Для live: IH_CLASSIFY_ONLY=0 ih send …");
    process.exitCode = 2;
    return;
  }

  // canary = один lead через батч-механику с maxSends=1
  const leadId = opts.leadId ?? opts.canary;
  if (!leadId && !opts.account) {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }

  // аккаунт: явный или по лиду
  let account;
  if (opts.account) {
    account = getAccount(db, opts.account);
  } else {
    const lead0 = db.prepare("SELECT * FROM leads WHERE id = ? OR substr(id,1,8) = ?").get(leadId, leadId);
    account = lead0?.account_id ? getAccount(db, lead0.account_id) : db.prepare("SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at LIMIT 1").get();
  }
  if (!account) {
    console.log("аккаунт не найден: ih accounts add --anty-profile <id> …");
    process.exitCode = 2;
    return;
  }
  if (!account.anty_profile_id) {
    console.log(`у аккаунта ${account.id.slice(0, 8)} нет anty_profile_id`);
    process.exitCode = 2;
    return;
  }

  console.log(`send${dryRun ? " (dry-run)" : " [LIVE]"}: account=${account.id.slice(0, 8)} anty=${account.anty_profile_id}${leadId ? ` lead=${leadId}` : ""}`);

  const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });
  const results = await runAccountBatch({
    db,
    account,
    client,
    profileId: account.anty_profile_id,
    dryRun,
    maxSends: leadId ? 1 : 3,
    onlyLeadId: leadId ?? null,
    canary: Boolean(opts.canary),
    logger,
    stateDir: STATE_DIR,
  });
  for (const r of results) {
    console.log(`  ${r.lead.slice(0, 8)} → ${r.outcome}${r.status ? ` (${r.status})` : ""}`);
  }
  if (!results.length) process.exitCode = 2;
}
