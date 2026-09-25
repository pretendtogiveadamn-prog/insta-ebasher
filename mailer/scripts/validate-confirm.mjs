// Валидация confirmSent против РЕАЛЬНОГО чата (read-only, ничего не отправляет).
// Открывает мини-чат с handle, читает DOM, проверяет domConfirmMatches на уже отправленном тексте.
// node --env-file=state/.env scripts/validate-confirm.mjs <handle> "<draftText>"
import { AntyClient } from "../src/browser/anty.mjs";
import { attachProfile } from "../src/browser/attach.mjs";
import { Humanizer } from "../src/browser/human.mjs";
import { loadZone } from "../src/core/contract.mjs";
import { resolveCandidates } from "../src/core/resolver.mjs";
import { deepQuery } from "../src/core/dom.mjs";
import { waitThreadOpen, humanClick } from "../src/flows/dm.mjs";
import { collectThreadData, domConfirmMatches } from "../src/flows/verify.mjs";

const [handle, draft] = process.argv.slice(2);
if (!handle || !draft) {
  console.error("usage: node scripts/validate-confirm.mjs <handle> \"<draft>\"");
  process.exit(1);
}

const client = new AntyClient();
const { page, browser, ownTab } = await attachProfile(client, "ee976e65-9645-405f-9240-cf85d6f71538", { newTabUrl: "https://www.instagram.com/" });
const h = new Humanizer(page);
try {
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
  await h.dwell(page, 4000);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
  await h.pause(800, 1500);
  const zone = loadZone(process.cwd(), "profile");
  const btnEl = zone.elements.find((e) => e.label === "profile_message_button");
  const cand = await deepQuery(page, { cssSelector: "*", limit: 4000 });
  const res = resolveCandidates(btnEl, cand);
  if (!res.winner) throw new Error("Message button не найден");
  await humanClick(h, page, res.winner);
  const opened = await waitThreadOpen(page, { timeoutMs: 25000 });
  if (!opened.ok) throw new Error("тред не открылся");
  const data = await collectThreadData(page, draft);
  const verdict = domConfirmMatches(data, draft);
  console.log(JSON.stringify({ opened, verdict, inComposer: data.inComposer, threadLen: data.threadText.length }, null, 1));
} finally {
  if (ownTab) await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
