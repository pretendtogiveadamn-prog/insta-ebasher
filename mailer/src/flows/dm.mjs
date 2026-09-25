// dm.mjs — state-machine отправки DM (spec 02): S0 attach → S10 log.
// Fail-closed: exact-handle (S2), жёсткое подтверждение (S8), капча-гейт, action-block.
// Live-отправка требует verified контрактов; pending разрешён только в dry-run.
import { make, fromUnknown } from "../core/errors.mjs";
import { loadAllZones, liveGateOk } from "../core/contract.mjs";
import { deepQuery } from "../core/dom.mjs";
import { resolveCandidates, makeMissError } from "../core/resolver.mjs";
import { saveEvidence } from "../core/evidence.mjs";
import { attachProfile } from "../browser/attach.mjs";
import { Humanizer } from "../browser/human.mjs";
import { handleTextMatches, isExactHandle, detectActionBlockText, isAccountSuspendedUrl } from "./handle.mjs";
import { detectCaptcha, captchaCountToday, captchaGate, waitForManualSolve } from "./captcha.mjs";
import { confirmSent, attachNetworkConfirm } from "./verify.mjs";
import { ROOT } from "../core/paths.mjs";
import { discoverElement, recordDiscovery } from "../core/discovery.mjs";

export const DM_STEPS = ["S0_attach", "S1_goto_profile", "S2_verify_handle", "S3_profile_dwell", "S4_message_button", "S5_thread_open", "S6_compose", "S7_send", "S8_confirm", "S9_exit", "S10_log"];

// ── contract-gate: live требует verified, dry-run разрешает pending ──
// canary: bootstrap первого live-DM (owner-апрувнутая цель) — все зоны кроме send-confirm;
// send-confirm верифицируется этим же канарей-прогоном (S8 runtime + post-audit).
export function contractsForMode(dryRun, { canary = false } = {}) {
  const zones = loadAllZones(ROOT);
  if (dryRun) return { zones, gate: { ok: true, missing: [] } };
  const required = canary
    ? ["profile", "thread", "action-block", "captcha", "login"]
    : ["profile", "thread", "send-confirm", "action-block", "captcha", "login"];
  const gate = liveGateOk(zones, required);
  return { zones, gate };
}

// ── precheck (до входа в machine, fail-closed) spec 02 ──
export function precheck({ db, account, lead, mode, canary = false }) {
  if (!account?.enabled) throw make("SessionError", "аккаунт disabled", { step: "precheck", accountId: account?.id });
  if (account.cooldown_until && new Date(account.cooldown_until) > new Date()) {
    throw make("ActionBlockError", `аккаунт в cooldown до ${account.cooldown_until}`, { step: "precheck", accountId: account.id });
  }
  if (!lead || lead.status !== "ready") {
    throw make("SessionError", `lead не в статусе ready (${lead?.status ?? "null"}) — LLM-вердикт обязателен`, { step: "precheck", leadId: lead?.id });
  }
  if (!lead.draft || !lead.handle) {
    throw make("LlmError", "нет draft или handle — DM не отправляем (fail-closed)", { step: "precheck", leadId: lead?.id });
  }
  const cap = account.daily_cap ?? 25;
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString();
  const sentToday = db
    .prepare("SELECT COUNT(*) n FROM outreach_log WHERE account_id = ? AND outcome = 'sent' AND dry_run = 0 AND sent_at >= ?")
    .get(account.id, dayStart).n;
  if (sentToday >= cap) {
    throw make("SessionError", `daily cap исчерпан (${sentToday}/${cap})`, { step: "precheck", accountId: account.id });
  }
  const { gate } = contractsForMode(mode === "dry_run", { canary });
  if (!gate.ok) {
    throw make("SessionError", `live требует verified контрактов, pending: ${gate.missing.join(", ")}`, { step: "precheck", accountId: account.id });
  }
  return { sentToday, cap };
}

// ── резолв контрактного элемента через deepQuery-кандидаты ──
// само-хилинг: все стратегии промахнулись (DOM обновился) → discovery-правило ищет
// по семантике → найденная стратегия дописывается в контракт (pending) → след. прогон работает без discovery
export async function resolveOnPage(page, zones, zone, label, { discovery = true } = {}) {
  const z = zones.find?.((x) => x.zone === zone) ?? zones[zone];
  const el = z?.elements?.find((e) => e.label === label);
  if (!el) throw make("SelectorMissError", `в зоне ${zone} нет элемента ${label}`, { step: zone });
  const candidates = await deepQuery(page, { cssSelector: "*", limit: 4000 });
  const res = resolveCandidates(el, candidates);
  if (res.winner) return res.winner;
  // анти-самообман гард: state-элементы и allowDiscovery:false не хилятся (spec 01 §6)
  if (discovery && el.role !== "state" && el.allowDiscovery !== false) {
    const found = await discoverElement(page, zone, label);
    if (found?.winner) {
      try {
        recordDiscovery(ROOT, zone, label, found.strategy, `runtime ${new Date().toISOString()}`);
      } catch {}
      return found.winner;
    }
  }
  throw makeMissError(el, { zone, candidateCount: candidates.length }, { step: zone });
}

// ── state machine ──
export async function runDmFlow({
  client,
  profileId,
  account,
  lead,
  db,
  logger = () => {},
  stateDir,
  dryRun = true,
  zones = null,
  page = null,
  browser = null,
  openedByBot = false,
  human = null,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  manualSolveWaiter = null,
  canary = false,
  homeExitFn = homeExit, // DI для тестов (боевой — сайдбар Home + dwell)
}) {
  const jobId = `dm-${lead.id.slice(0, 8)}-${Date.now()}`;
  const steps = [];
  const useOwnAttach = !page;
  let netConfirm = null;
  const h = human ?? new Humanizer();

  const ev = async (step, extra = {}) => {
    steps.push(step);
    logger({ event: "dm_step", jobId, step, lead: lead.id, dryRun, ...extra });
    try {
      await saveEvidence({ stateDir, jobId, step, page, dom: null, meta: { leadId: lead.id, handle: lead.handle, dryRun, ...extra } });
    } catch {}
  };

  try {
    // S0 attach
    await ev("S0_attach");
    if (useOwnAttach) {
      const a = await attachProfile(client, profileId, { newTabUrl: "https://www.instagram.com/" });
      page = a.page;
      browser = a.browser;
      openedByBot = a.openedByBot;
    }
    if (!zones) ({ zones } = contractsForMode(dryRun, { canary }));
    if (!dryRun) {
      const { gate: liveGate } = contractsForMode(false, { canary });
      if (!liveGate.ok) throw make("SessionError", `live требует verified контрактов: ${liveGate.missing.join(", ")}`, { step: "S0", leadId: lead.id });
    }

    // капча-гейт (день-счётчик до старта)
    const capCount = captchaCountToday(db, account.id);

    // S1 goto profile
    await ev("S1_goto_profile");
    await h.pause(700, 2200); // «решил зайти на профиль» — не мгновенный переход
    await page.goto(`https://www.instagram.com/${lead.handle}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // splash ≠ профиль: SPA за резидентным прокси рендерится долго — ждём реальный контент (1 reload как человек)
    await waitProfileReady(page, zones, { sleepFn });
    await h.dwell(page, { minMs: 2000, maxMs: 4000, scroll: false });

    // капча-детект после goto (точка spec 07)
    const det0 = await detectCaptcha(page);
    const gate0 = captchaGate({ detected: det0.detected, countToday: capCount });
    if (gate0.action === "manual_solve") {
      await ev("S1_captcha_manual", { kind: det0.kind });
      await (manualSolveWaiter ?? waitForManualSolve)(page);
    }

    // S2 verify exact handle (fail-closed, TRAPS #5)
    await ev("S2_verify_handle");
    const profileData = await page.evaluate(() => {
      const links = [...document.querySelectorAll("header a[href^='/']")]
        .map((a) => a.getAttribute("href"))
        .filter(Boolean);
      const h1 = document.querySelector("header h1");
      const h2 = document.querySelector("header h2");
      return {
        links,
        h1: h1?.innerText ?? h1?.textContent ?? "",
        h2: h2?.innerText ?? h2?.textContent ?? "",
        title: document.title ?? "",
        url: location.pathname,
      };
    });
    const expected = String(lead.handle).replace(/^@/, "");
    // сигналы (любой достаточен): ЛЮБАЯ header-ссылка = /handle/ (первая может быть @меншном из био —
    // баг babyfxce.e 2026-09-25), h1/h2 = handle, title "Name (@handle)", или канонический url
    const hrefOk = profileData.links.some((h) => isExactHandle(String(h).replace(/\//g, ""), expected));
    const headerOk = handleTextMatches(profileData.h1, expected) || handleTextMatches(profileData.h2, expected);
    const titleOk = profileData.title.toLowerCase().includes(`(@${expected.toLowerCase()})`);
    if (!hrefOk && !headerOk && !titleOk) {
      throw make("RecipientResolutionError", `exact-handle не подтверждён: h1="${profileData.h1}" h2="${profileData.h2}" links=${JSON.stringify(profileData.links.slice(0, 5))} url=${profileData.url} ≠ @${expected}`, {
        step: "S2_verify_handle",
        leadId: lead.id,
        probe: profileData,
      });
    }

    // S3 profile dwell (человеческое чтение)
    await ev("S3_profile_dwell");
    await h.dwell(page, { minMs: 3000, maxMs: 8000, scroll: true });
    // назад к шапке (дочитал → вернулся наверх, там кнопка Message): офф-скрин бокс = промах клика
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
    await h.pause(800, 1600);

    // S4 message button — маршрут А (кнопка на профиле) с фолбэком Б (/direct/new/ поиск).
    // live 2026-09-24: Message-кнопки на профиле может не быть — тогда поиск по хэндлу.
    await ev("S4_message_button");
    // ТОЛЬКО route A: кнопка Message на профиле. Route B (/direct/new/) убран по требованию owner
    // 2026-09-25: «основной рут — через профиль с кнопкой, если кнопки нет — не надо».
    // Нет кнопки = получатель недоступен (рестрикшн/приват) → лид failed, аккаунт НЕ штрафуем, кд 2 мин, дальше.
    try {
      const btn = await resolveOnPage(page, zones, "profile", "profile_message_button");
      await h.pause(1200, 2600); // взгляд нашёл кнопку → пауза до клика (медленнее, owner 2026-09-25)
      await humanClick(h, page, btn);
    } catch (e) {
      if (e?.code !== "SelectorMissError") throw e;
      throw make("RecipientResolutionError", `нет кнопки Message на профиле @${expected} — получатель недоступен, пропускаем`, {
        step: "S4_message_button",
        leadId: lead.id,
      });
    }
    const route = "A";

    // S5 thread open: реальное открытие = url /direct/t/ ИЛИ видимый composer.
    // Мини-чат (попап справа внизу) НЕ меняет url — детектим по composer'у (owner 2026-09-25).
    await ev("S5_thread_open");
    const opened = await waitThreadOpen(page, { timeoutMs: 25000, sleepFn }); // прокси медленный — 25с
    if (!opened.ok) {
      // restriction: получатель ограничил входящие → не штрафовать аккаунт
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      if (/can'?t message|нельзя отправить/i.test(bodyText)) {
        throw make("DmRestrictedError", "получатель ограничил входящие DM", { step: "S5_thread_open", leadId: lead.id });
      }
      throw make("RecipientResolutionError", `тред не открылся после клика (route ${route}): url=${String(page.url?.() ?? "")}`, { step: "S5_thread_open", leadId: lead.id });
    }
    // can-message детект: рестрикшн-тексты в открытом чате → DmRestrictedError, аккаунт НЕ штрафуем
    await assertNoRestriction(page, lead);
    // fail-closed верификация получателя В ТРЕДЕ (TRAPS #5): заголовок треда ссылается на /handle/
    const recip = await verifyThreadRecipient(page, expected, { sleepFn });
    if (!recip.ok) {
      throw make("RecipientResolutionError", `тред открыт, но получатель не подтверждён: нет ссылки /${expected}/ (header="${recip.headerText}")`, {
        step: "S5_thread_open",
        leadId: lead.id,
        probe: { links: recip.links.slice(0, 20) },
      });
    }
    const composer = await resolveOnPage(page, zones, "thread", "composer");
    await h.pause(400, 1200);
    await humanClick(h, page, composer);

    // капча-детект после открытия треда (mid-flow точка spec 07)
    const det5 = await detectCaptcha(page);
    const gate5 = captchaGate({ detected: det5.detected, countToday: capCount });
    if (gate5.action === "manual_solve") {
      await ev("S5_captcha_manual", { kind: det5.kind });
      await (manualSolveWaiter ?? waitForManualSolve)(page);
    }

    // S6 compose: дубль-чек (текст уже есть в переписке → НЕ шлём повторно) → печать по символам (Shift+Enter, TRAPS #1/#2)
    await ev("S6_compose");
    // дубль-чек по ПУЗЫРЯМ (не по всей странице — «yo» матчилось подстрокой в «you/your», ложный скип 2026-09-25).
    // Короткие драфты (<12 симв) — только exact-пузырь; длинные — вхождение по скелету.
    const dupHit = await page.evaluate((needle) => {
      const skel = (s) => String(s ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const d = skel(needle);
      if (!d) return false;
      const bubbles = [...document.querySelectorAll("div[dir='auto']")].map((e) => skel(e.textContent));
      return bubbles.some((b) => (d.length < 12 ? b === d : b.includes(d)));
    }, lead.draft).catch(() => false);
    if (dupHit) {
      await ev("S6_skip_duplicate", { note: "наш текст уже в переписке — дубль-DM запрещён" });
      await h.linger();
      await closeMiniChat(page, h, { logger }); // не оставляем попап открытым на время кд
      await homeExitFn(page, h, { sleepFn, logger }).catch(() => {});
      return { ok: true, skipped: "duplicate", dryRun, jobId, steps, openedByBot };
    }
    await h.typeText(page, lead.draft);

    // S7 send
    await ev("S7_send");
    if (dryRun) {
      await ev("S7_dry_run_stop", { note: "dry-run: Enter НЕ нажат, текст не отправлен" });
      await h.linger();
      await closeMiniChat(page, h, { logger }); // не оставляем набросок в попапе
      return { ok: true, dryRun: true, jobId, steps, openedByBot };
    }
    netConfirm = attachNetworkConfirm(page);
    await h.pause(700, 2000); // перечитал написанное — не мгновенный Enter
    await page.keyboard.press("Enter");

    // S8 CONFIRM (жёсткое post-условие)
    await ev("S8_confirm");
    await confirmSent({ page, draftText: lead.draft, netConfirm });

    // S9 exit: linger → закрыть мини-чат крестиком → по-человечески на главную «в кд» (spec 08 S12-S15).
    await ev("S9_exit");
    await h.linger();
    await closeMiniChat(page, h, { logger });
    await homeExitFn(page, h, { sleepFn, logger });

    // action-block финальная проверка
    const url9 = String(page.url?.() ?? "");
    if (isAccountSuspendedUrl(url9)) {
      throw make("ActionBlockError", "аккаунт приостановлен (/accounts/suspended/)", { step: "S9_exit", leadId: lead.id });
    }
    const bodyText9 = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const blockPattern = detectActionBlockText(bodyText9);
    if (blockPattern) {
      throw make("ActionBlockError", `action-block: «${blockPattern}»`, { step: "S9_exit", leadId: lead.id });
    }

    // S10 log (не здесь — db пишет вызывающий, сюда only telemetry)
    await ev("S10_log");
    netConfirm?.detach();
    return { ok: true, dryRun: false, jobId, steps, openedByBot };
  } catch (e) {
    const typed = fromUnknown(e, { step: steps.at(-1) ?? "S0", leadId: lead.id, accountId: account.id });
    logger({ event: "dm_fail", jobId, error: typed.code, message: typed.message, steps });
    try {
      const failDom = await deepQuery(page, { cssSelector: "*", limit: 4000 }).catch(() => null);
      await saveEvidence({ stateDir, jobId, step: `fail_${typed.step}`, page, dom: failDom, meta: { error: typed.toJSON() } });
    } catch {}
    netConfirm?.detach();
    // fail-рековери по-человечески (owner 2026-09-25): уйти на главную через сайдбар, не бросать вкладку
    // в середине сценария. Best-effort: homeExit не бросает (goto-фолбэк внутри), ошибки глотаем.
    if (page) await homeExitFn(page, h, { sleepFn, logger }).catch(() => {});
    throw typed;
  } finally {
    if (useOwnAttach && browser) {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          const own = await p.evaluate(() => window.__ih2 !== undefined).catch(() => false);
          if (own) await p.close().catch(() => {});
        }
      }
      await browser.close().catch(() => {});
    }
  }
}

// кандидат резолвера → CSS-локатор для клика (если id есть — по id; иначе css-хинт)
export function cssForCandidate(c) {
  if (c?.id) return `#${c.id}`;
  if (c?.classes?.length) return `${c.tag}.${c.classes[0]}`;
  return c?.tag ?? "div";
}

// клик по deepQuery-кандидату: координатный bezier (box) → css-фолбэк.
// box — со времени сбора; страницу могли проскроллить → офф-скрин бокс = промах
// (баг 2026-09-25 levelthreethesis: S3-скролл унёс Message из вьюпорта, клик ушёл в пустоту).
// Рекавери: scrollIntoView по locator → свежий boundingBox → клик.
export async function humanClick(h, page, c) {
  const vw = page.viewportSize?.()?.width ?? 1440;
  const vh = page.viewportSize?.()?.height ?? 900;
  let b = c?.box;
  const offscreen = !b || !(b.w > 0) || !(b.h > 0) || b.y < 0 || b.y > vh - 4 || b.x < 0 || b.x > vw - 4;
  if (offscreen && page.locator) {
    try {
      const el = page.locator(cssForCandidate(c)).first();
      await el.scrollIntoViewIfNeeded({ timeout: 3000 });
      await h.pause(400, 900);
      b = await el.boundingBox();
    } catch {
      b = null;
    }
  }
  if (b && b.w > 0) {
    if (h.clickBox && (await h.clickBox(page, b))) return;
    if (await h.clickCandidate(page, { ...c, box: b })) return;
  }
  await h.clickSelector(page, cssForCandidate(c));
}

// точный ряд в /direct/new/ выдаче: первая строка текста = хэндл (TRAPS #5: deezzo_prod ≠ deezzo_prod3)
export async function findExactResultRow(page, handle) {
  const target = String(handle).replace(/^@/, "").trim().toLowerCase();
  // deepQuery склеивает textContent без переносов («Allstar Shawn22k_dooterYou both follow…») —
  // строковый матч невозможен (баг 2026-09-25). Матчим по СПАНАМ ряда: exact handle или «@handle».
  return await page.evaluate((t) => {
    for (const row of document.querySelectorAll("div[role='button']")) {
      const hit = [...row.querySelectorAll("span")].some((s) => {
        const v = (s.textContent ?? "").trim().toLowerCase();
        return v === t || v === `@${t}`;
      });
      if (!hit) continue;
      const r = row.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      return { tag: "div", text: (row.textContent ?? "").slice(0, 120), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }
    return null;
  }, target).catch(() => null);
}

// SPA-готовность: domcontentloaded ≠ контент. Элемент зоны резолвится (без discovery) — страница живая.
// Таймаут → TransientError (страница/прокси мертвы — это НЕ ошибка получателя).
export async function waitForElement(page, zones, zone, label, { timeoutMs = 25000, pollMs = 700, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const z = zones.find?.((x) => x.zone === zone) ?? zones[zone];
  const el = z?.elements?.find((e) => e.label === label);
  if (!el) throw make("SelectorMissError", `в зоне ${zone} нет элемента ${label}`, { step: zone });
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    const candidates = await deepQuery(page, { cssSelector: "*", limit: 4000 }).catch(() => []);
    lastCount = candidates.length;
    const res = resolveCandidates(el, candidates);
    if (res.winner) return { winner: res.winner, candidates };
    await sleepFn(pollMs);
  }
  throw make("TransientError", `${zone}/${label} не появился за ${timeoutMs}ms (candidates=${lastCount} — страница не прогрузилась)`, { step: zone });
}

// профиль готов = header_username резолвится. Человек при зависшей загрузке жмёт F5 — 1 reload.
export async function waitProfileReady(page, zones, { timeoutMs = 25000, sleepFn } = {}) {
  try {
    return await waitForElement(page, zones, "profile", "header_username", { timeoutMs, sleepFn });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    return await waitForElement(page, zones, "profile", "header_username", { timeoutMs: 15000, sleepFn });
  }
}

// выдача /direct/new/ рендерится асинхронно — поллим exact-ряд (null = не появился за таймаут)
export async function waitExactResultRow(page, handle, { timeoutMs = 12000, pollMs = 700, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await findExactResultRow(page, handle).catch(() => null);
    if (row) return row;
    if (Date.now() >= deadline) return null;
    await sleepFn(pollMs);
  }
}

// реальное открытие треда: url /direct/t/ ИЛИ видимый composer (in-place на /direct/new/).
// /direct/new/ без composer'а — НЕ тред (ложный матч regex /direct/ — баг 2026-09-24).
export async function waitThreadOpen(page, { timeoutMs = 15000, pollMs = 500, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = String(page.url?.() ?? "");
    if (/\/direct\/t\//.test(url)) return { ok: true, via: "url", url };
    const hasComposer = await page
      .evaluate(() => {
        for (const el of document.querySelectorAll("div[role='textbox']")) {
          const r = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden") return true;
        }
        return false;
      })
      .catch(() => false);
    if (hasComposer) return { ok: true, via: "composer", url }; // мини-чат: url не меняется — composer решает
    await sleepFn(pollMs);
  }
  return { ok: false, url: String(page.url?.() ?? "") };
}

// fail-closed верификация получателя В ОТКРЫТОМ треде: в pane треда есть ссылка на /handle/
// (заголовок треда / аватар / View profile). Заголовок дорендеривается после url — поллим до 8с.
export async function verifyThreadRecipient(page, expected, { timeoutMs = 8000, pollMs = 600, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const exp = String(expected).replace(/^@/, "").trim().toLowerCase();
  let data = { links: [], headerText: "" };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    data = await page
      .evaluate(() => {
        const links = [];
        for (const a of document.querySelectorAll("a[href]")) {
          const href = (a.getAttribute("href") ?? "").split("?")[0];
          const m = /^\/([\w.]+)\/?$/.exec(href);
          if (m) links.push(m[1].toLowerCase());
          if (links.length >= 80) break;
        }
        const header =
          document.querySelector("div[role='main'] h1, div[role='main'] h2, main h1")?.textContent ?? "";
        return { links, headerText: String(header).trim().slice(0, 120) };
      })
      .catch(() => ({ links: [], headerText: "" }));
    if (data.links.includes(exp)) return { ok: true, links: data.links, headerText: data.headerText };
    if (Date.now() >= deadline) return { ok: false, links: data.links, headerText: data.headerText };
    await sleepFn(pollMs);
  }
}

// рестрикшн-паттерны открытого чата: получатель не принимает DM → DmRestrictedError, аккаунт НЕ штрафуем
const RESTRICTION_RE = /can'?t (receive|message)|isn'?t accepting( new)? messages|invite[ -]only|not everyone can message|не можете отправить|нельзя отправить/i;
export async function assertNoRestriction(page, lead = null) {
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const m = RESTRICTION_RE.exec(text);
  if (m) throw make("DmRestrictedError", `получатель не принимает DM: «${m[0]}»`, { step: "S5_restriction", leadId: lead?.id });
}

// S13: мини-чат (попап справа внизу, url НЕ /direct/) — закрыть крестиком. Best-effort.
export async function closeMiniChat(page, h, { logger = () => {} } = {}) {
  try {
    const url = String(page.url?.() ?? "");
    if (/\/direct\//.test(url)) return false; // полный тред не закрываем — уходим через Home
    const vw = page.viewportSize?.()?.width ?? 1440;
    const icons = await deepQuery(page, { cssSelector: "svg[aria-label='Close'], svg[aria-label='Закрыть']", limit: 80 }).catch(() => []);
    // ✕ мини-чата — в правой половине экрана (попап справа внизу); левые Close (модалки) не трогаем
    const btn = icons.find((c) => c.visible && (c.box?.w ?? 0) > 0 && c.box.x > vw * 0.5);
    if (!btn) return false;
    await h.pause(400, 900);
    await h.clickCandidate(page, btn).catch(() => {});
    logger({ event: "minichat_closed" });
    return true;
  } catch {
    return false; // best-effort
  }
}

// FEED_COOLDOWN (spec 08 S16): кд на главной ленте — скролл-рывки + паузы; health-чек раз в ~8 циклов
// Кд на ленте ПОСЛЕ DM (spec 08 S12-S15). Без робо-скролла (owner 2026-09-25: «скроллит по-роботски»):
// человек просто сидит на странице — длинные паузы + редкие микродвижения мыши. Action-block вотчер остаётся.
export async function cooldownOnFeed(page, h, seconds, { sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), logger = () => {} } = {}) {
  const deadline = Date.now() + seconds * 1000;
  logger({ event: "feed_cooldown_start", secs: Math.round(seconds) });
  let cycle = 0;
  while (Date.now() < deadline) {
    const chunk = 12000 + Math.random() * 28000; // 12–40с тихого ожидания
    await sleepFn(Math.min(chunk, Math.max(0, deadline - Date.now())));
    if (h.moveTo && Math.random() < 0.4) {
      await h.moveTo(page, 300 + Math.random() * 600, 200 + Math.random() * 400).catch(() => {});
    }
    if (++cycle % 4 === 0) {
      const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      const block = detectActionBlockText(text);
      if (block) throw make("ActionBlockError", `action-block во время cooldown: «${block}»`, { step: "S16_feed_cooldown" });
    }
  }
  logger({ event: "feed_cooldown_done", secs: Math.round(seconds) });
}
// (полный goto / за резидентным прокси виснет ~30с — TRAPS #6), потом dwell со скроллом.
// BEST-EFFORT: DM уже подтверждён — сбой выхода НЕ фейлит outcome.
export async function homeExit(page, h, { shellTimeoutMs = 15000, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), logger = () => {} } = {}) {
  try {
    const candidates = await deepQuery(page, { cssSelector: "a[href='/'], svg[aria-label='Home']", limit: 50 }).catch(() => []);
    const home = candidates.find((c) => c.visible && (c.box?.w ?? 0) > 0);
    if (home) {
      await h.pause(600, 1500); // «дочитал → потянулся к меню»
      await h.clickCandidate(page, home).catch(() => {});
    } else {
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }
    const deadline = Date.now() + shellTimeoutMs;
    while (Date.now() < deadline) {
      const onHome = await page
        .evaluate(() => location.pathname === "/" && Boolean(document.querySelector("main, div[role='main']")))
        .catch(() => false);
      if (onHome) break;
      await sleepFn(600);
    }
    await h.dwell(page, { minMs: 12000, maxMs: 25000, scroll: true }); // «в кд»: полистал ленту
    logger({ event: "dm_home_exit", ok: true });
  } catch (e) {
    logger({ event: "dm_home_exit_fail", error: String(e?.message ?? e) }); // outcome не трогаем
  }
}
