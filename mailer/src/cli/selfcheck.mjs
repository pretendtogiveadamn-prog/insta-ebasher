// selfcheck CLI — spec 01 §2: gate → attach → снапшот → 7 пунктов → evidence → baseline.
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { AntyClient } from "../browser/anty.mjs";
import { attachProfile } from "../browser/attach.mjs";
import { runSelfcheck } from "../browser/selfcheck.mjs";

// timezone ожидаемая — из Anty-профиля; fallback America/New_York
export async function cmdSelfcheck(profileArg, { country = "US" } = {}) {
  const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });
  let profileId = profileArg;
  let profile = null;
  try {
    const profiles = await client.profiles();
    const found = profiles.find(
      (p) => p.id === profileArg || p.name === profileArg || String(p.uuid) === profileArg
    );
    if (found) {
      profile = found;
      profileId = found.id;
    } else {
      console.log(`профиль «${profileArg}» не найден в панели`);
      process.exitCode = 2;
      return;
    }
  } catch (e) {
    console.error(`selfcheck FAIL: панель недоступна: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR);
  const expectTimezone = profile?.timezone || process.env.IH_EXPECT_TZ || "America/New_York";

  try {
    const res = await runSelfcheck({
      client,
      profileId,
      db,
      logger,
      stateDir: STATE_DIR,
      expectTimezone,
      requireCountry: country,
      attachPage: async (id) => {
        const a = await attachProfile(client, id, { newTabUrl: "https://bot.sannysoft.com/" });
        return { page: a.page, browser: a.browser, openedByBot: a.openedByBot };
      },
    });
    console.log(`\nselfcheck ${profileArg} — ${res.green ? "GREEN (7/7)" : "FAIL"} (passed=${res.results.filter((r) => r.ok).length}/7, openedByBot=${res.openedByBot})`);
    for (const r of res.results) {
      console.log(`${r.ok ? "✔" : "✖"} ${r.point.padEnd(22)} ${r.detail}`);
    }
    if (!res.green) process.exitCode = 1;
  } catch (e) {
    console.error(`selfcheck FAIL: ${e.code ?? ""} ${e.message}`);
    process.exitCode = 1;
  }
}
