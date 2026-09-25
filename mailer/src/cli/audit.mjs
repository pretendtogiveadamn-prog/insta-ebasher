// audit CLI — live контракт-аудит IG (spec 05 L2): резолвит зоны на живом DOM,
// пишет evidence, с --apply помечает verified в contracts/*.yaml.
// Путь: профиль-страница → (опц. --thread) тред. Канарей-отправки НЕ делает.
import { STATE_DIR, DB_PATH, ROOT } from "../core/paths.mjs";
import { openDb } from "../core/db.mjs";
import { makeLogger } from "../core/log.mjs";
import { loadAllZones, loadZone } from "../core/contract.mjs";
import { deepQuery } from "../core/dom.mjs";
import { resolveCandidates } from "../core/resolver.mjs";
import { saveEvidence } from "../core/evidence.mjs";
import { attachProfile } from "../browser/attach.mjs";
import { Humanizer } from "../browser/human.mjs";
import { AntyClient } from "../browser/anty.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import { findExactResultRow, waitThreadOpen, verifyThreadRecipient, waitForElement, waitProfileReady, waitExactResultRow, humanClick } from "../flows/dm.mjs";

const CODE_MARKERS = ["__URL_CHECK__", "__DRAFT_TEXT__", "__CODE_CHECK__", "__NETWORK_OK__"];

const isCodeElement = (el) =>
  CODE_MARKERS.some((m) => el.strategies?.some((s) => s.v === m)) || el.allowDiscovery === false;

const substituteDraft = (el, draft) =>
  draft
    ? {
        ...el,
        strategies: el.strategies.map((s) => (s.v === "__DRAFT_TEXT__" ? { ...s, v: draft } : s)),
      }
    : el;

export async function cmdAudit(handle, opts = {}) {
  const h = String(handle ?? "").replace(/^@/, "").trim();
  if (!h) {
    console.log("usage: ih audit <handle> [--thread] [--apply] [--draft <text>] [--account <id>] [--mark-zone <zone> --evidence <ref>]");
    process.exitCode = 2;
    return;
  }
  const db = openDb(DB_PATH);
  const logger = makeLogger(STATE_DIR, {});
  const account = opts.account
    ? db.prepare("SELECT * FROM accounts WHERE id = ? OR label = ? OR username = ?").get(opts.account, opts.account, opts.account)
    : db.prepare("SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at LIMIT 1").get();
  if (!account?.anty_profile_id) {
    console.log("аккаунт не найден/без anty_profile_id");
    process.exitCode = 2;
    return;
  }

  const client = new AntyClient({ token: process.env.ANTY_TOKEN || "" });
  const { page, browser } = await attachProfile(client, account.anty_profile_id, { newTabUrl: "https://www.instagram.com/" });
  const hum = new Humanizer();
  const zones = loadAllZones(ROOT);
  const report = { at: new Date().toISOString(), handle: h, route: null, recipient: null, matched: {}, code: {}, detectors: {}, missed: {}, threadOpened: false };
  const jobId = `audit-${h}-${Date.now()}`;

  // ── Phase 1: страница профиля (человеческий темп: пауза до перехода → dwell-чтение) ──
  await hum.pause(800, 2500);
  await page.goto(`https://www.instagram.com/${h}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  // splash ≠ профиль: ждём реальный рендер (SPA за прокси), 1 reload внутри при необходимости
  await waitProfileReady(page, zones, { timeoutMs: 30000, sleepFn: (ms) => page.waitForTimeout(ms) });
  await hum.dwell(page, { minMs: 2500, maxMs: 5000, scroll: true });
  const profUrl = page.url();
  if (isChallengeUrl(profUrl)) {
    console.log(`captcha/challenge на профиле: ${profUrl} — аудит невозможен (manual-solve нужен)`);
    process.exitCode = 2;
    return;
  }
  const candidates = await deepQuery(page, { cssSelector: "*", limit: 4000 });
  await saveEvidence({ stateDir: STATE_DIR, jobId, step: "profile_page", page, dom: null, meta: { handle: h } });

  // Phase 1 = зоны профиля. thread/send-confirm резолвятся в Phase 2 на странице треда;
  // action-block/captcha — детекторы: на здоровой странице ДОЛЖНЫ молчать (матч = ⚠️ ложный позитив).
  for (const zname of ["profile", "login"]) {
    const zone = zones.find((z) => z.zone === zname);
    if (!zone) continue;
    for (const el of zone.elements) {
      if (isCodeElement(el)) {
        report.code[`${zname}/${el.label}`] = "code-check";
        continue;
      }
      const res = resolveCandidates(substituteDraft(el, opts.draft), candidates);
      if (res.winner) {
        report.matched[`${zname}/${el.label}`] = strategyInfo(res);
      } else {
        report.missed[`${zname}/${el.label}`] = `${res.byStrategy.length ? "no viable" : "no match"}`;
      }
    }
  }
  // детекторные зоны на здоровой странице: сработка = ложный позитив → контракт чинить
  for (const zname of ["action-block", "captcha"]) {
    const zone = zones.find((z) => z.zone === zname);
    if (!zone) continue;
    for (const el of zone.elements) {
      if (isCodeElement(el)) {
        report.code[`${zname}/${el.label}`] = "code-check";
        continue;
      }
      const res = resolveCandidates(substituteDraft(el, opts.draft), candidates);
      if (res.winner) report.detectors[`${zname}/${el.label}`] = `⚠️ FALSE-POSITIVE на здоровой странице [${strategyInfo(res)}]`;
    }
  }
  console.log(`profile page: url=${profUrl} candidates=${candidates.length}`);

  // ── Phase 2: тред (--thread): маршрут А (кнопка Message) → фолбэк Б (/direct/new/ поиск, как dm-flow) ──
  if (opts.thread) {
    const btnEl = zones.find((z) => z.zone === "profile").elements.find((e) => e.label === "profile_message_button");
    // сначала к шапке (dwell-скролл уносит кнопку), потом СВЕЖИЙ резолв — бокс актуальный, не stale
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
    await hum.pause(800, 1600);
    const freshCand = await deepQuery(page, { cssSelector: "*", limit: 4000 });
    const btnRes = resolveCandidates(substituteDraft(btnEl, opts.draft), freshCand);
    let opened = false;
    if (btnRes.winner) {
      report.route = "A";
      report.matched["profile/profile_message_button"] = strategyInfo(btnRes);
      await hum.pause(1200, 2400);
      await humanClick(hum, page, btnRes.winner);
      opened = (await waitThreadOpen(page, { timeoutMs: 25000 })).ok; // прокси медленный
    } else {
      report.route = "B"; // Message-кнопки на профиле нет (норма для части аккаунтов)
    }
    if (!opened) {
      // маршрут Б (live 2026-09-24: Message-кнопки на профиле может не быть)
      await hum.pause(800, 2000);
      await page.goto("https://www.instagram.com/direct/new/", { waitUntil: "domcontentloaded", timeout: 30000 });
      // ждём реальное поле поиска (SPA-рендер), потом человеческий dwell
      const searchReady = await waitForElement(page, zones, "direct-new", "search_input", { timeoutMs: 20000, sleepFn: (ms) => page.waitForTimeout(ms) }).catch(() => null);
      if (searchReady?.winner) {
        report.matched["direct-new/search_input"] = "ready+resolved (waitForElement)";
        await hum.dwell(page, { minMs: 1200, maxMs: 2500, scroll: false });
        await hum.pause(400, 1200);
        await humanClick(hum, page, searchReady.winner);
        await hum.typeText(page, h);
        const row = await waitExactResultRow(page, h, { timeoutMs: 12000, sleepFn: (ms) => page.waitForTimeout(ms) });
        if (row) {
          report.matched["direct-new/result_row"] = `exact-match "${String(row.text ?? "").split("\n")[0]}"`;
          await hum.pause(500, 1400);
          await humanClick(hum, page, row);
          opened = (await waitThreadOpen(page, { timeoutMs: 25000 })).ok; // /direct/new/ без composer'а ≠ тред
        } else {
          report.missed["direct-new/result_row"] = `exact "${h}" не найден в выдаче (12с поллинга)`;
        }
      } else {
        report.missed["direct-new/search_input"] = "не появился за 20с (страница не прогрузилась)";
      }
    }
    if (!opened) {
      console.log(`тред не открылся: ${page.url()}`);
      process.exitCode = 2;
    } else {
        report.threadOpened = true;
        const recip = await verifyThreadRecipient(page, h);
        report.recipient = recip.ok ? `exact /${h}/ в треде` : `НЕ ПОДТВЕРЖДЁН (header="${recip.headerText}")`;
        await page.waitForTimeout(2500);
        const threadCand = await deepQuery(page, { cssSelector: "*", limit: 4000 });
        await saveEvidence({ stateDir: STATE_DIR, jobId, step: "thread_page", page, dom: null, meta: { handle: h } });
        for (const zname of ["thread", "send-confirm"]) {
          const zone = zones.find((z) => z.zone === zname);
          for (const el of zone.elements) {
            if (isCodeElement(el)) {
              report.code[`${zname}/${el.label}`] = "code-check";
              continue;
            }
            const res = resolveCandidates(substituteDraft(el, opts.draft), threadCand);
            if (res.winner) report.matched[`${zname}/${el.label}`] = strategyInfo(res);
            else report.missed[`${zname}/${el.label}`] = "no viable";
          }
        }
        console.log(`thread page: url=${page.url()}`);
    }
  }

  // ── отчёт ──
  console.log("\n── matched (DOM live) ──");
  for (const [k, v] of Object.entries(report.matched)) console.log(`  ✔ ${k}  [${v}]`);
  console.log(`route: ${report.route ?? "-"}  recipient: ${report.recipient ?? "-"}`);
  console.log("── code-check (проверяется кодом в рантайме) ──");
  for (const k of Object.keys(report.code)) console.log(`  • ${k}`);
  if (Object.keys(report.detectors).length) {
    console.log("── детекторы (сработка на здоровой странице = ложный позитив) ──");
    for (const [k, v] of Object.entries(report.detectors)) console.log(`  ⚠️ ${k} (${v})`);
  }
  if (Object.keys(report.missed).length) {
    console.log("── missed ──");
    for (const [k, v] of Object.entries(report.missed)) console.log(`  ✖ ${k} (${v})`);
  }
  const domOk = Object.keys(report.matched).length;
  const codeOk = Object.keys(report.code).length;
  console.log(`\naudit ${h}: matched=${domOk} code=${codeOk} missed=${Object.keys(report.missed).length} evidence=state/evidence/${jobId}*`);

  // ── --apply: пометить verified ──
  if (opts.apply) {
    const evidence = opts.evidence ? String(opts.evidence) : `audit ${jobId}`;
    const toMark = new Set(Object.keys(report.matched));
    if (opts.evidence) for (const k of Object.keys(report.code)) toMark.add(k); // code-элементы: только с явным evidence (dry-run/canary ref)
    let marked = 0;
    const byZone = {};
    for (const key of toMark) {
      const [zname, label] = key.split("/");
      (byZone[zname] ??= []).push(label);
    }
    for (const [zname, labels] of Object.entries(byZone)) {
      const zone = loadZone(ROOT, zname);
      for (const el of zone.elements) {
        if (!labels.includes(el.label)) continue;
        el.verified = { status: "verified", at: new Date().toISOString(), evidence };
      }
      writeFileSync(zone.file, yaml.dump(zone, { lineWidth: 120 }));
      marked += labels.length;
    }
    // --mark-zone: целиком зону (bootstrap: детект-зоны, code-элементы) с явным evidence
    if (opts.markZone && opts.evidence) {
      const zone = loadZone(ROOT, String(opts.markZone));
      for (const el of zone.elements) {
        el.verified = { status: "verified", at: new Date().toISOString(), evidence: String(opts.evidence) };
      }
      writeFileSync(zone.file, yaml.dump(zone, { lineWidth: 120 }));
      marked += zone.elements.length;
      console.log(`mark-zone ${zone.zone}: +${zone.elements.length} (bootstrap, evidence: ${opts.evidence})`);
    }
    console.log(`apply: помечено verified = ${marked} (evidence: ${evidence})`);
  }
  process.exitCode = Object.keys(report.missed).length ? 1 : 0;
  logger({ event: "audit_done", handle: h, matched: domOk, code: codeOk, missed: Object.keys(report.missed).length, jobId });
  // cleanup: свою вкладку закрываем, CDP-коннект рвём (Chrome панели живёт)
  try {
    await page.close().catch(() => {});
  } catch {}
  await browser.close().catch(() => {});
  return report;
}

function strategyInfo(res) {
  const s = res.winner?.strategyIndex ?? res.byStrategy.find((b) => b.won)?.index;
  return `strategy#${s ?? "?"} ${res.winner?.tag ?? ""}${res.winner?.attrs?.role ? `[role=${res.winner.attrs.role}]` : ""} text="${(res.winner?.text ?? "").slice(0, 40)}"`;
}


function isChallengeUrl(url) {
  return /\/challenge/i.test(String(url));
}
