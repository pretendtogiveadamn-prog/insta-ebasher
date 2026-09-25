// experiment-minichat — улика: клик Message на профиле → что открывается (мини-чат vs /direct/t/).
// Read-only: ничего не печатает и не отправляет. Скрин + DOM-дамп + urls.
// usage: node --env-file=state/.env scripts/experiment-minichat.mjs <handle>
import { STATE_DIR, ROOT } from "../src/core/paths.mjs";
import { openDb } from "../src/core/db.mjs";
import { attachProfile } from "../src/browser/attach.mjs";
import { AntyClient } from "../src/browser/anty.mjs";
import { Humanizer } from "../src/browser/human.mjs";
import { loadAllZones } from "../src/core/contract.mjs";
import { waitProfileReady } from "../src/flows/dm.mjs";
import { deepQuery } from "../src/core/dom.mjs";
import { resolveCandidates } from "../src/core/resolver.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const handle = (process.argv[2] ?? "deezzo_prod").replace(/^@/, "");
const db = openDb(process.env.IH_DB ?? `${STATE_DIR}/insta-ebasher-v2.db`);
const account = db.prepare("SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at LIMIT 1").get();
const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });
const { page, browser } = await attachProfile(client, account.anty_profile_id, { newTabUrl: "https://www.instagram.com/" });
const h = new Humanizer();
const zones = loadAllZones(ROOT);
const dir = `${STATE_DIR}/evidence/minichat-${handle}-${Date.now()}`;
mkdirSync(dir, { recursive: true });

console.log("1. профиль", handle);
await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await waitProfileReady(page, zones, { timeoutMs: 30000 });
await h.dwell(page, { minMs: 2500, maxMs: 4000, scroll: true });

const candidates = await deepQuery(page, { cssSelector: "*", limit: 4000 });
const btnEl = zones.find((z) => z.zone === "profile").elements.find((e) => e.label === "profile_message_button");
const btn = resolveCandidates(btnEl, candidates);
if (!btn.winner) {
  console.log("Message-кнопки НЕТ на этом профиле (route B аккаунт)");
  await browser.close().catch(() => {});
  process.exit(3);
}
console.log("2. клик Message:", JSON.stringify(btn.winner.box));
await h.pause(1000, 2000);
await h.clickCandidate(page, btn.winner);

// мини-чат рендерится со скелетоном — ждём настоящий composer до 20с
let textboxes = [];
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  const cs = await deepQuery(page, { cssSelector: "div[role='textbox']", limit: 200 });
  textboxes = cs.filter((c) => c.visible && (c.box?.w ?? 0) > 0);
  if (textboxes.length) break;
  await h.pause(700, 900);
}
console.log("3. composer появился:", textboxes.length > 0, "url:", page.url());
await page.screenshot({ path: `${dir}/after_click.png` });

// дамп кандидатов: composer + контейнер попапа + ссылки на хэндл + рестрикшн-тексты
const after = await deepQuery(page, { cssSelector: "*", limit: 4000 });
const dialogs = after.filter((c) => c.role === "dialog" && c.visible);
const handleLinks = after.filter((c) => c.tag === "a" && (c.href ?? "").replace(/\/$/, "") === `/${handle}`);
const restrictions = after.filter((c) => /can'?t (receive|message)|isn'?t accepting|invite only|не можете отправить/i.test(String(c.text ?? "")) && String(c.text ?? "").length < 200);
console.log("4. textboxes:", textboxes.length, "dialogs:", dialogs.length, "links-to-handle:", handleLinks.length, "restrictions:", restrictions.length);
writeFileSync(
  `${dir}/dump.json`,
  JSON.stringify(
    {
      urlAfter: page.url(),
      textboxes: textboxes.map((c) => ({ tag: c.tag, text: c.text?.slice(0, 40), placeholder: c.placeholder, box: c.box, ancestors: c.ancestors?.slice(0, 8) })),
      dialogs: dialogs.map((c) => ({ tag: c.tag, ariaLabel: c.ariaLabel, classes: c.classes?.slice(0, 4), box: c.box, text: c.text?.slice(0, 60) })),
      handleLinks: handleLinks.slice(0, 10).map((c) => ({ href: c.href, text: c.text?.slice(0, 40), box: c.box })),
      restrictions: restrictions.map((c) => ({ tag: c.tag, text: c.text?.slice(0, 120), box: c.box })),
    },
    null,
    1
  )
);
console.log("evidence:", dir);
// свою вкладку закрываем — ничего не отправляли
await page.close().catch(() => {});
await browser.close().catch(() => {});
