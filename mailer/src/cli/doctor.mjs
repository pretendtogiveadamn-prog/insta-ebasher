// doctor — Phase 0 gate: Anty panel health + CDP pool + SQLite + LLM креды.
// Никаких live-действий: только read-only проверки.
import { existsSync, statSync } from "node:fs";
import { STATE_DIR, DB_PATH } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { AntyClient, cdpAlive } from "../browser/anty.mjs";
import { chromeModeEnabled, chromeCdpPort } from "../browser/attach-chrome.mjs";

export async function cmdDoctor() {
  const lines = [];
  let ok = true;

  // Клиентский режим без Anty (chromeModeEnabled: IH_CHROME_CDP или просто нет ANTY_TOKEN)
  const chromeCdp = chromeModeEnabled() ? chromeCdpPort() : null;
  if (chromeCdp) {
    const alive = await cdpAlive(chromeCdp, { timeoutMs: 2000 });
    lines.push(["chrome cdp", alive ? "ok" : "FAIL", alive ? `127.0.0.1:${chromeCdp} alive` : `127.0.0.1:${chromeCdp} не отвечает — запустите start-chrome.bat`]);
    if (!alive) ok = false;
  }

  if (!chromeCdp) {
  // Anty panel
  const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });
  try {
    const h = await client.health();
    lines.push(["anty panel", "ok", `health=${JSON.stringify(h)}`]);
  } catch (e) {
    ok = false;
    lines.push(["anty panel", "FAIL", e.message]);
  }

  // CDP pool: running profiles + живость их cdpPort
  try {
    const profiles = await client.profiles();
    const running = profiles.filter((p) => p.running);
    const poolLines = [];
    for (const p of running.slice(0, 8)) {
      const alive = p.cdpPort ? Boolean(await cdpAlive(p.cdpPort, { timeoutMs: 1000 })) : false;
      poolLines.push(`${p.name || p.id}: cdp=${p.cdpPort ?? "—"} ${alive ? "alive" : "dead"}`);
    }
    lines.push(["cdp pool", "ok", `running=${running.length}/${profiles.length}; ${poolLines.join("; ") || "—"}`]);
  } catch (e) {
    ok = false;
    lines.push(["cdp pool", "FAIL", e.message]);
  }
  } // !chromeCdp

  // SQLite
  try {
    const db = openDb(DB_PATH);
    const counts = {
      accounts: db.prepare("SELECT COUNT(*) n FROM accounts").get().n,
      leads: db.prepare("SELECT COUNT(*) n FROM leads").get().n,
      outreach_log: db.prepare("SELECT COUNT(*) n FROM outreach_log").get().n,
    };
    lines.push(["sqlite", "ok", `${DB_PATH} ${JSON.stringify(counts)}`]);
  } catch (e) {
    ok = false;
    lines.push(["sqlite", "FAIL", e.message]);
  }

  // secrets
  lines.push(["state/.env", existsSync(`${STATE_DIR}/.env`) ? "ok" : "note", existsSync(`${STATE_DIR}/.env`) ? "найден (не в git)" : "не найден — скопируй из state/.env.example"]);

  // LLM creds
  const llmKey = process.env.OPENROUTER_API_KEY || process.env.IH_OPENROUTER_KEY;
  lines.push(["llm (openrouter)", llmKey ? "ok" : "note", llmKey ? "ключ задан" : "OPENROUTER_API_KEY не задан (Phase 3)"]);

  // playwright
  let pwVer = "?";
  try {
    pwVer = (await import("playwright-core"))._package?.version ?? (JSON.parse((await import("node:fs")).readFileSync("node_modules/playwright-core/package.json", "utf8")).version);
  } catch {}
  lines.push(["playwright", "ok", `pw ${pwVer}`]);

  console.log("\nih doctor");
  for (const [name, status, detail] of lines) {
    console.log(`${status === "ok" ? "✔" : status === "note" ? "◦" : "✖"} ${name.padEnd(16)} ${detail}`);
  }
  if (!ok) process.exitCode = 1;
}
