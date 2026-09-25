// mail CLI — рассылка по v1-lease (ADR v2-over-v1). Агент делает research/ревью/апрув
// в v1, потом запускает `ih mail` — движок механически исполняет кампанию через Anty.
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { getAccount } from "../orch/accounts.mjs";
import { AntyClient } from "../browser/anty.mjs";
import { V1Bridge } from "../bridge/v1.mjs";
import { runMailer } from "../orch/mailer.mjs";

const USAGE = `usage:
  ih mail --v1 http://127.0.0.1:3000 --account <id> [--max N] [--dry-run]
  env IH_V1_URL — альтернатива --v1
  live: v1 mode=live_enabled (SEND_REAL_MESSAGES в панели) + IH_CLASSIFY_ONLY=0`;

export async function cmdMail(opts = {}) {
  const v1Url = opts.v1 || process.env.IH_V1_URL || "";
  if (!v1Url) {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR, {
    sink: (ev) => {
      try {
        db.prepare("INSERT INTO events (level, scope, code, msg, data) VALUES (?, ?, ?, ?, ?)").run(
          ev.error ? "error" : "info",
          ev.event ?? null,
          ev.error ?? null,
          ev.message ?? null,
          JSON.stringify(ev)
        );
      } catch {}
    },
  });

  let account = opts.account
    ? getAccount(db, opts.account) ?? db.prepare("SELECT * FROM accounts WHERE label = ? OR username = ?").get(opts.account, opts.account)
    : db.prepare("SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at LIMIT 1").get();
  if (!account || !account.anty_profile_id) {
    console.log("аккаунт не найден/без anty_profile_id: ih accounts add --anty-profile <id> …");
    process.exitCode = 2;
    return;
  }

  console.log(
    `mail${opts.dryRun ? " (dry-run)" : opts.canary ? " [CANARY]" : ""}: v1=${v1Url} account=${account.id.slice(0, 8)} anty=${account.anty_profile_id} max=${opts.canary ? 1 : Number(opts.max ?? 10) || 10}`
  );

  let out;
  try {
    out = await runMailer({
      db,
      client: new AntyClient({ token: process.env.ANTY_TOKEN || "" }),
      account,
      v1: new V1Bridge({ baseUrl: v1Url }),
      logger,
      stateDir: STATE_DIR,
      maxSends: Number(opts.max ?? 10) || 10,
      forceDryRun: Boolean(opts.dryRun),
      canary: Boolean(opts.canary),
    });
  } catch (e) {
    console.error(`mail: ${e?.message ?? e}`);
    process.exitCode = 1;
    return;
  }

  for (const r of out.results) console.log(`  @${r.handle} → ${r.outcome}${r.code ? ` (${r.code})` : ""}`);
  console.log(`mailer: ${out.results.length} обработано, стоп: ${out.stopped}`);
  const sent = out.results.filter((r) => r.outcome === "sent").length;
  const previewed = out.results.filter((r) => r.outcome === "previewed").length;
  if (!out.results.length || (!sent && !previewed)) process.exitCode = 2;
}
