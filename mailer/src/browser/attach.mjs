// attach.mjs — ensureAttachable → playwright connectOverCDP → рабочий таб с маркером.
// Бот не двигает существующие вкладки (инвариант spec 01 §1, правило ytbot-2:
// не плодить вкладки — лимит своих, переиспользование своей).
import { chromium } from "playwright-core";
import { ensureAttachable } from "./anty.mjs";

// Marker: in-page флаг window.__ih2 + data-атрибут на <html>
export async function markPage(page, marker) {
  await page.addInitScript(
    (m) => {
      window.__ih2 = m;
      try {
        document.documentElement.dataset.ih2 = m.id ?? "1";
      } catch {}
    },
    marker
  );
  await page.evaluate((m) => {
    window.__ih2 = m;
    try {
      document.documentElement.dataset.ih2 = m.id ?? "1";
    } catch {}
  }, marker).catch(() => {});
}

export async function isOwnTab(page) {
  return await page.evaluate(() => window.__ih2 !== undefined).catch(() => false);
}

export function ownTabs(browser) {
  return browser.contexts().flatMap((c) => c.pages());
}

async function filterOwn(pages) {
  const out = [];
  for (const p of pages) {
    if (p.isClosed()) continue;
    if (await isOwnTab(p)) out.push(p);
  }
  return out;
}

// attach + получение РАБОЧЕЙ вкладки:
// 1) есть своя вкладка → переиспользуем (goto только если target другой)
// 2) своих нет и own < maxOwnTabs → создаём новую с маркером
// 3) своих >= maxOwnTabs → НИКОГДА не создаём новую; переиспользуем первую свою
export async function attachProfile(client, profileId, { newTabUrl = null, maxOwnTabs = 3 } = {}) {
  const { profile, openedByBot } = await ensureAttachable(client, profileId);
  const r = await attachCdp({ cdpUrl: `http://127.0.0.1:${profile.cdpPort}`, markerId: profileId, newTabUrl, maxOwnTabs });
  return { ...r, profile, openedByBot };
}

// Универсальный CDP-attach (Anty Chrome или обычный Chrome с --remote-debugging-port).
// Клиентский режим без Anty: attach-chrome.mjs зовёт это с портом 9222.
export async function attachCdp({ cdpUrl, markerId, newTabUrl = null, maxOwnTabs = 3 }) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error("cdp: нет контекстов после attach");
  const ctx = contexts[0];

  let own = await filterOwn(ctx.pages());
  let page = own[0] ?? null;
  let created = false;
  if (!page) {
    if (own.length >= maxOwnTabs) {
      throw new Error(`cdp: лимит ${maxOwnTabs} своих вкладок исчерпан, но ни одной живой не найдено`);
    }
    page = await ctx.newPage();
    await markPage(page, { id: markerId, at: new Date().toISOString() });
    created = true;
    own = await filterOwn(ctx.pages());
  }
  if (newTabUrl && page.url() !== newTabUrl) {
    await page.goto(newTabUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  }
  if (own.length > maxOwnTabs) {
    for (const extra of own.slice(0, own.length - maxOwnTabs)) {
      await extraClose(extra);
    }
  }
  return { page, browser, reused: !created, ownTabCount: own.length };
}

async function extraClose(page) {
  await page.close().catch(() => {});
}
