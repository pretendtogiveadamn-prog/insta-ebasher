// dood — Phase 0 DoD-харнесс (spec 05/06): L1 green, doctor-части, 0 секретов в коде.
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeModeEnabled, chromeCdpPort } from "../browser/attach-chrome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function cmdDood() {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  // L1: node --test
  let testOut = "";
  try {
    testOut = execFileSync(process.execPath, ["--test", ...readdirSync(join(ROOT, "test", "unit")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/unit/${f}`)], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    const pass = /pass (\d+)/.exec(testOut);
    const fail = /fail (\d+)/.exec(testOut);
    push("L1 unit tests", pass && fail && Number(fail[1]) === 0, `pass=${pass?.[1]} fail=${fail?.[1]}`);
  } catch (e) {
    const out = String(e.stdout ?? e);
    const pass = /pass (\d+)/.exec(out);
    const fail = /fail (\d+)/.exec(out);
    push("L1 unit tests", false, pass && fail ? `pass=${pass[1]} fail=${fail[1]}` : `crash: ${e.message?.slice(0, 120)}`);
  }

  // doctor-части (без live-браузера); клиентский режим (IH_CHROME_CDP или нет ANTY_TOKEN): Chrome CDP
  if (chromeModeEnabled()) {
    const port = chromeCdpPort();
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      push("chrome cdp", Boolean(r?.Browser), `${r?.Browser ?? "?"} @127.0.0.1:${port}`);
    } catch (e) {
      push("chrome cdp", false, e.message);
    }
  } else {
    try {
      const h = await fetch("http://127.0.0.1:3200/api/health").then((r) => r.json());
      push("anty panel health", h?.ok === true || h?.running !== undefined, JSON.stringify(h));
    } catch (e) {
      push("anty panel health", false, e.message);
    }
  }

  // секреты в коде: grep по src/ на паттерны ключей
  let secretsFound = [];
  try {
    const out = execFileSync(
      "grep",
      ["-rIn", "-E", "(sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9_\\-]{20,}=[A-Za-z0-9]|(api[_-]?key|token)\\s*[:=]\\s*['\"][A-Za-z0-9_\\-]{16,})", "src/", "run.mjs"],
      { cwd: ROOT, encoding: "utf8" }
    );
    secretsFound = out.trim().split("\n").filter(Boolean);
  } catch {
    // grep exit 1 = не найдено — это успех
  }
  push("0 секретов в коде", secretsFound.length === 0, secretsFound.length ? secretsFound.slice(0, 3).join(" | ") : "чисто");

  // контракты IG-зон: парсинг + все pending до live-аудита
  try {
    const { loadAllZones, contractStatuses } = await import("../core/contract.mjs");
    const zones = loadAllZones(ROOT);
    const st = contractStatuses(zones);
    const total = Object.values(st).reduce((n, z) => n + Object.keys(z).length, 0);
    const verified = Object.values(st).reduce((n, z) => n + Object.values(z).filter((s) => s === "verified").length, 0);
    push(
      "contract-зоны",
      zones.length >= 6,
      `${zones.length} зон, ${total} элементов, verified=${verified}/${total} (live требует verified — dry-run работает с pending)`
    );
  } catch (e) {
    push("contract-зоны", false, e.message);
  }

  // само-хилинг: правила соответствуют flat-форме deepQuery (регрессия 2026-09-24: правила были мёртвы)
  try {
    const { DISCOVERY_RULES, suggestStrategy, validateSuggestion } = await import("../core/discovery.mjs");
    const flat = { visible: true, disabled: false, ancestors: ["div"], hostChain: [], classes: [], text: "", ariaLabel: null, placeholder: null, href: null, name: null, role: null, tag: "div", id: null };
    const fixtures = {
      "thread/composer": [{ ...flat, role: "textbox" }],
      "profile/header_username": [{ ...flat, tag: "h1", text: "someuser" }],
      "direct-new/search_input": [{ ...flat, tag: "input", name: "searchInput" }],
      "login/nav_own_profile_link": [{ ...flat, tag: "a", href: "/direct/inbox/" }],
      "send-confirm/sent_status_icon": [{ ...flat, tag: "svg", ariaLabel: "Sent" }],
      "profile/profile_message_button": [{ ...flat, role: "button", text: "Message" }],
    };
    const bad = [];
    for (const [key, cs] of Object.entries(fixtures)) {
      const rule = DISCOVERY_RULES[key];
      const w = rule?.(cs);
      if (!w) { bad.push(`${key}:no-match`); continue; }
      if (!validateSuggestion(suggestStrategy(w), cs, w)) bad.push(`${key}:self-check`);
    }
    // анти-фолс-позитив: «Messages» топ-бара не хилится в кнопку Message
    const fp = DISCOVERY_RULES["profile/profile_message_button"]?.([{ ...flat, tag: "a", role: "link", text: "Messages", href: "/direct/inbox/" }]);
    if (fp) bad.push("profile_message_button:сработал на 'Messages'");
    push("discovery rules (flat-forma)", bad.length === 0, bad.length ? bad.join(" | ") : `${Object.keys(fixtures).length} правил живые, анти-фолс-позитив ок`);
  } catch (e) {
    push("discovery rules (flat-forma)", false, e.message);
  }

  console.log("\nih dood — Phase 0 gate (spec 06)");
  let all = true;
  for (const c of checks) {
    all = all && c.ok;
    console.log(`${c.ok ? "✔" : "✖"} ${c.name.padEnd(22)} ${c.detail}`);
  }
  console.log(all ? "\nPHASE 0 GATE: GREEN" : "\nPHASE 0 GATE: FAIL");
  if (!all) process.exitCode = 1;
}
