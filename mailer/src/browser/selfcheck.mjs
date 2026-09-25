// fingerprint-selfcheck — spec 01 §2 (7 пунктов). Чистая часть (verdict по снапшоту)
// unit-тестируема; page-часть — только CDP-сбор. 7/7 = pass; до этого live-отправок нет.
import { make, fromUnknown } from "../core/errors.mjs";
import { saveEvidence, jobEvidenceDir } from "../core/evidence.mjs";
import { proxyGate } from "./gate.mjs";
import { attachProfile } from "./attach.mjs";

export const SELFCHECK_POINTS = [
  "webdriver_false",
  "ip_us_proxy",
  "webrtc_clean",
  "ua_locale_tz",
  "device_fp_baseline",
  "chrome_plugins",
  "sannysoft_screenshot",
];

// Вердикт по снапшоту (pure). canvas-дрейф = алерт, не fail (spec 02 precheck: ≥6/7).
export function evaluateSelfcheck(snap, { baseline = null, requireCountry = "US", chromeVersion = null } = {}) {
  const results = [];
  const push = (point, ok, detail) => results.push({ point, ok, detail: String(detail) });

  push("webdriver_false", snap.webdriver === false, `webdriver=${snap.webdriver}`);

  const geoOk = Boolean(snap.inBrowserIp) && snap.inBrowserIp === snap.gateIp && snap.inBrowserGeo === requireCountry;
  push(
    "ip_us_proxy",
    geoOk,
    `inBrowserIp=${snap.inBrowserIp ?? "none"} ==gateIp(${snap.gateIp ?? "none"}): ${snap.inBrowserIp === snap.gateIp}, geo=${snap.inBrowserGeo ?? "?"} (need ${requireCountry})`
  );

  push("webrtc_clean", snap.webrtcLocalCandidates === 0, `localCandidates=${snap.webrtcLocalCandidates}`);

  const uaChrome = /Chrome\/(\d+)/.exec(snap.userAgent || "");
  const panelMajor = chromeVersion == null ? null : String(chromeVersion);
  const versionOk = panelMajor ? Boolean(uaChrome && uaChrome[1] === panelMajor) : Boolean(uaChrome);
  const uaOk = versionOk && !snap.headlessUA;
  const tzOk = snap.timezone === snap.expectedTimezone;
  push(
    "ua_locale_tz",
    uaOk && tzOk,
    `uaVer=${uaChrome?.[1] ?? "?"} (panel=${chromeVersion ?? "?"}) headless=${snap.headlessUA} langs=${(snap.languages || []).join(",")} tz=${snap.timezone} expected=${snap.expectedTimezone}`
  );

  const fpCollected = snap.deviceFp && Object.keys(snap.deviceFp).length > 0;
  const fpOk = !fpCollected
    ? false
    : !baseline
      ? null // first run: baseline записан, пункт зачтён с пометкой
      : Object.keys(baseline).every((k) => String(baseline[k]) === String(snap.deviceFp[k]));
  push(
    "device_fp_baseline",
    fpOk !== false,
    !fpCollected
      ? "device-fp сбор не удался — верификация невозможна (fail-closed)"
      : fpOk === null
        ? "first run: baseline записан"
        : "baseline совпадает"
  );

  // plugins>0 — реальные PDF-плагины Chrome; chrome.runtime отсутствует у чистого Chrome
  // без расширений (панель стартует с --disable-extensions) — это норм, не бот-маркер.
  // Значение runtime оставляем в detail для визуальной проверки.
  const pluginsOk = (snap.pluginsCount ?? 0) > 0;
  push("chrome_plugins", pluginsOk, `chrome.runtime=${snap.chromeRuntime} plugins=${snap.pluginsCount}`);

  const shotOk = Boolean(snap.sannysoftShot);
  push("sannysoft_screenshot", shotOk, shotOk ? "screenshot собран (визуальная оглядка в evidence)" : "screenshot не собран");

  const green = results.every((r) => r.ok);
  const passed = results.filter((r) => r.ok).length;
  return { results, green, passed, firstRun: !baseline && fpCollected };
}

// Сбор снапшота из живой страницы (CDP/Playwright). IP проверяется В БРАУЗЕРЕ
// (через прокси профиля!) и сверяется с gate-пробой.
export async function collectSnapshot(page, { expectedTimezone, gateIp, proxyHost, screenshotPath = null }) {
  const dom = await page.evaluate(
    async ({ expectedTimezone, gateIp, proxyHost }) => {
      const rtc = await new Promise((resolve) => {
        try {
          const pc = new RTCPeerConnection({ iceServers: [] });
          const found = [];
          let done = false;
          const finish = (n) => {
            if (!done) {
              done = true;
              try { pc.close(); } catch {}
              resolve(n);
            }
          };
          pc.createDataChannel("x");
          pc.onicecandidate = (e) => {
            if (e.candidate && (e.candidate.address || "").match(/^(192\.168\.|10\.|172\.|fe80)/)) found.push(e.candidate.address);
            if (!e.candidate) finish(found.length);
          };
          pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(-1));
          setTimeout(() => finish(found.length), 1500);
        } catch {
          resolve(-1);
        }
      });
      const deviceFp = {};
      try {
        const c = document.createElement("canvas");
        c.width = 200;
        c.height = 50;
        let prev = null;
        for (let i = 0; i < 3; i++) {
          deviceFp.canvasHash = c.toDataURL().slice(-64);
          if (prev === deviceFp.canvasHash) break;
          prev = deviceFp.canvasHash;
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {}
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        deviceFp.webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch {}
      let inBrowserIp = null, inBrowserGeo = null;
      try {
        const r = await fetch("https://ipwho.is/?fields=success,ip,country_code", { signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        if (j.success !== false && j.ip) {
          inBrowserIp = j.ip;
          inBrowserGeo = j.country_code;
        }
      } catch {}
      return {
        webdriver: navigator.webdriver,
        inBrowserIp,
        inBrowserGeo,
        gateIp,
        proxyHost,
        webrtcLocalCandidates: rtc,
        userAgent: navigator.userAgent,
        headlessUA: /Headless/.test(navigator.userAgent),
        languages: navigator.languages,
        platform: navigator.platform,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        expectedTimezone,
        deviceFp,
        chromeRuntime: typeof window.chrome !== "undefined" && !!window.chrome.runtime,
        pluginsCount: navigator.plugins?.length ?? 0,
        windowWidth: window.innerWidth || window.outerWidth,
        windowHeight: window.innerHeight || window.outerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
      };
    },
    { expectedTimezone, gateIp, proxyHost }
  );
  if (screenshotPath) {
    const ok = await page.screenshot({ path: screenshotPath, fullPage: false }).then(() => true, () => false);
    dom.sannysoftShot = ok;
  }
  return dom;
}

async function gateForProfile(client, profileId, { requireCountry }) {
  const p = await client.profile(profileId);
  const value = p.proxy?.value ?? null;
  const res = await proxyGate({ proxyValue: value, requireCountry }).then(
    (r) => ({ ...r, proxyValue: value }),
    (e) => ({ ok: false, reason: e.message })
  );
  if (res.ok && value) {
    try {
      const u = new URL(value.includes("://") ? value : `http://${value}`);
      res.proxyHost = u.hostname;
    } catch {}
  }
  return res;
}

function getBaseline(db, profileId) {
  const rows = db.prepare("SELECT key, value FROM fp_baseline WHERE profile_id=?").all(profileId);
  if (!rows.length) return null;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setBaseline(db, profileId, deviceFp) {
  for (const [key, value] of Object.entries(deviceFp ?? {})) {
    db.prepare(
      "INSERT INTO fp_baseline (profile_id, key, value) VALUES (?,?,?) " +
      "ON CONFLICT(profile_id, key) DO UPDATE SET value=excluded.value, captured_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).run(profileId, key, String(value));
  }
}

// Полный selfcheck-флоу: gate → attach → goto sannysoft → снапшот → verdict →
// evidence → baseline. Evidence пишется и при сбое. Приложение передаёт attachPage.
export async function runSelfcheck({ client, profileId, db, logger, stateDir, expectTimezone, requireCountry = "US", attachPage }) {
  const jobId = `selfcheck-${Date.now()}`;
  let page = null;
  let browser = null;
  try {
    const gate = await gateForProfile(client, profileId, { requireCountry });
    if (!gate.ok) throw make("ProxyError", `selfcheck gate: ${gate.reason}`, { step: "gating", jobId, accountId: profileId });

    const attached = await attachPage(profileId);
    page = attached.page;
    browser = attached.browser;
    const snap = await collectSnapshot(page, {
      expectedTimezone: expectTimezone,
      gateIp: gate.ip,
      proxyHost: gate.proxyHost ?? null,
      screenshotPath: `${jobEvidenceDir(stateDir, jobId, "selfcheck")}/sannysoft.png`,
    });
    const baseline = getBaseline(db, profileId);
    const chromeVersion = browser ? /Chrome\/(\d+)/.exec(await browser.version())?.[1] ?? null : null;
    const verdict = evaluateSelfcheck(snap, { baseline, requireCountry, chromeVersion });
    if (verdict.firstRun) setBaseline(db, profileId, snap.deviceFp);

    await saveEvidence({ stateDir, jobId, step: "selfcheck", page, dom: snap, meta: { profileId, verdict } });
    logger?.({ event: "selfcheck", jobId, profileId, green: verdict.green, results: verdict.results });
    return { jobId, green: verdict.green, results: verdict.results, openedByBot: attached.openedByBot };
  } catch (e) {
    const typed = fromUnknown(e, { step: "selfcheck", jobId, accountId: profileId });
    logger?.({ event: "selfcheck_fail", jobId, profileId, error: typed.code, message: typed.message });
    try {
      await saveEvidence({
        stateDir,
        jobId,
        step: "selfcheck",
        page,
        dom: page ? { error: typed.message } : null,
        meta: { profileId, error: typed.toJSON() },
      });
    } catch {}
    throw typed;
  } finally {
    if (browser) {
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
