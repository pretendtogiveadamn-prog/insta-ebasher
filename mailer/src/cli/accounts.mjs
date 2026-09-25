// accounts CLI — list/add/pause/cap (spec 04)
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { listAccounts, getAccount, addAccount, pauseAccount, setCap, isCooldownActive } from "../orch/accounts.mjs";

const USAGE = `usage:
  ih accounts list
  ih accounts add --anty-profile <id> [--username @x] [--cap N]
  ih accounts pause <id> --value 0|1
  ih accounts cap <id> --value N`;

export async function cmdAccounts(action = "list", id, opts = {}) {
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR);

  if (action === "list") {
    const rows = listAccounts(db);
    if (!rows.length) {
      console.log("аккаунтов нет. add: ih accounts add --anty-profile <id> --username @x --cap 25");
      return;
    }
    for (const a of rows) {
      const cd = isCooldownActive(a) ? ` cooldown до ${a.cooldown_until} (${a.cooldown_reason})` : "";
      console.log(`${a.enabled ? "✔" : "✖"} ${a.id.slice(0, 8)} ${a.username ?? "?"} anty=${a.anty_profile_id} cap=${a.daily_cap}${cd}`);
    }
    return;
  }

  if (action === "add") {
    if (!opts.antyProfile) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const a = addAccount(db, {
      label: opts.label,
      antyProfileId: opts.antyProfile,
      username: opts.username,
      dailyCap: opts.cap ? Number(opts.cap) : 25,
    });
    logger({ event: "account_add", id: a.id, anty: a.anty_profile_id });
    console.log(`добавлен: ${a.id.slice(0, 8)} anty=${a.anty_profile_id} cap=${a.daily_cap}`);
    return;
  }

  if (action === "pause") {
    if (!id) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const enabled = Number(opts.value ?? 0) ? 1 : 0;
    const a = pauseAccount(db, id, enabled);
    if (!a) {
      console.log(`аккаунт ${id} не найден`);
      process.exitCode = 2;
      return;
    }
    console.log(`enabled=${a.enabled}`);
    return;
  }

  if (action === "cap") {
    if (!id || !opts.value) {
      console.log(USAGE);
      process.exitCode = 2;
      return;
    }
    const a = setCap(db, id, Number(opts.value));
    if (!a) {
      console.log(`аккаунт ${id} не найден`);
      process.exitCode = 2;
      return;
    }
    console.log(`cap=${a.daily_cap}`);
    return;
  }

  console.log(USAGE);
  process.exitCode = 2;
}
