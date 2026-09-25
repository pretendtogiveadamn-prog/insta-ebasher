// stats CLI — spec 04: sent/reply-rate/outcome-разбивка по аккаунтам, trend N дней.
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";

export async function cmdStats(days = 7) {
  const db = openDb(DB_PATH);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const byOutcome = db
    .prepare("SELECT outcome, COUNT(*) n FROM outreach_log WHERE sent_at >= ? GROUP BY outcome ORDER BY n DESC")
    .all(since);
  const byAccount = db
    .prepare(
      "SELECT account_id, COUNT(*) total, SUM(outcome='sent') sent FROM outreach_log WHERE sent_at >= ? GROUP BY account_id"
    )
    .all(since);
  const replies = db
    .prepare("SELECT l.account_id, COUNT(*) n FROM leads l WHERE l.replied = 1 AND l.sent_at >= ? GROUP BY l.account_id")
    .all(since);
  const caps = db.prepare("SELECT id, daily_cap, enabled FROM accounts").all();

  console.log(`\nih stats (${days}д)`);
  console.log("\nby outcome:");
  if (!byOutcome.length) console.log("  — (пусто)");
  for (const r of byOutcome) console.log(`  ${r.outcome.padEnd(18)} ${r.n}`);
  console.log("\nby account:");
  if (!byAccount.length) console.log("  — (пусто)");
  for (const a of byAccount) {
    const rep = replies.find((r) => r.account_id === a.account_id)?.n ?? 0;
    const cap = caps.find((c) => c.id === a.account_id)?.daily_cap ?? "?";
    const rate = a.sent ? ((rep / a.sent) * 100).toFixed(1) : "0.0";
    console.log(`  ${a.account_id.slice(0, 8)} sent=${a.sent}/${cap}/день total=${a.total} replies=${rep} rate=${rate}%`);
  }
}
