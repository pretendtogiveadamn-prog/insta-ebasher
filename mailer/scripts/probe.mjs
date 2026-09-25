// probe — read-only «глаза»: что сейчас на экране Anty-профиля.
// Ничего не навигирует и не закрывает: список вкладок + скрин каждой.
// usage: node --env-file=state/.env scripts/probe.mjs [antyProfileId]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { AntyClient } from "../src/browser/anty.mjs";

const profileId = process.argv[2] ?? "ee976e65-9645-405f-9240-cf85d6f71538";
const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });

const { ensureAttachable } = await import("../src/browser/anty.mjs");
const { profile } = await ensureAttachable(client, profileId); // профиль уже запущен (или поднимется)
const port = profile.cdpPort;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const dir = `state/evidence/probe-${Date.now()}`;
mkdirSync(dir, { recursive: true });
let i = 0;
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const url = page.url();
    const title = await page.title().catch(() => "?");
    const own = await page.evaluate(() => window.__ih2 !== undefined).catch(() => false);
    console.log(`tab${i}: ${own ? "[наша]" : "     "} ${url}  «${title}»`);
    await page.screenshot({ path: `${dir}/tab${i}.png` }).catch((e) => console.log(`tab${i}: скрин не удался: ${e.message}`));
    i++;
  }
}
console.log(`evidence: ${dir}`);
await browser.close().catch(() => {}); // рвём CDP-коннект, Chrome панели живёт
