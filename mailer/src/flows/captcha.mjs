// captcha.mjs — детект капчи/checkpoint + manual-solve MVP (spec 07).
// 1-я капча сессии → manual-solve (TG-алерт, ждём owner до IH_CAPTCHA_TIMEOUT=10мин);
// 2-я за день → stop + cooldown 24h. Таймаут → CaptchaError (retriable=false).
import { make } from "../core/errors.mjs";
import { isChallengeUrl } from "./handle.mjs";

export const CAPTCHA_TIMEOUT_MS_DEFAULT = 10 * 60 * 1000;

// Детект: URL /challenges/ ИЛИ photo-grid в DOM ИЛИ modal "Confirm your requests"
export async function detectCaptcha(page) {
  const url = safeUrl(page);
  if (isChallengeUrl(url)) return { detected: true, kind: "challenge_url", url };
  const dom = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const modalOpen = Boolean(document.querySelector("div[role='dialog']"));
    const modalText = modalOpen ? (document.querySelector("div[role='dialog']")?.innerText ?? "") : "";
    const gridImgs = document.querySelectorAll("div[role='dialog'] img").length;
    const modalConfirm = /confirm your requests|подтвердите запросы/i.test(modalText || bodyText);
    return { modalOpen, gridImgs, modalConfirm };
  }).catch(() => null);
  if (dom?.modalConfirm) return { detected: true, kind: "confirm_requests_modal", url, dom };
  if (dom && dom.modalOpen && dom.gridImgs >= 4) return { detected: true, kind: "photo_grid", url, dom };
  return { detected: false, kind: null, url, dom };
}

// Policy: счётчик капч за день (из outreach_log outcome='captcha')
export function captchaCountToday(db, accountId, now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  return db
    .prepare("SELECT COUNT(*) n FROM outreach_log WHERE account_id = ? AND outcome = 'captcha' AND sent_at >= ?")
    .get(accountId, dayStart).n;
}

export function captchaPolicy(countToday) {
  if (countToday <= 0) return "manual_solve"; // 1-я за день
  return "stop_and_cooldown_24h"; // 2-я+
}

// Manual-solve: алерт-функция (TG позже), ждём исчезновения капчи до timeout.
// resolveFn() — поллинг (переопределяется в тестах).
export async function waitForManualSolve(page, { timeoutMs = CAPTCHA_TIMEOUT_MS_DEFAULT, pollMs = 5000, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), onWait = null } = {}) {
  if (onWait) onWait({ event: "captcha_manual_solve", timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const det = await detectCaptcha(page);
    if (!det.detected) return { solved: true, waitedMs: timeoutMs - (deadline - Date.now()) };
    await sleepFn(pollMs);
  }
  throw make("CaptchaError", `капча не решена owner'ом за ${timeoutMs}ms`, { step: "captcha", probe: { kind: "manual_timeout" } });
}

// Точка интеграции в flow: на precheck и на каждом step-check.
// Возвращает {blocked:false} или бросает CaptchaError по policy.
export function captchaGate({ detected, countToday }) {
  if (!detected) return { action: "proceed" };
  const policy = captchaPolicy(countToday);
  if (policy === "manual_solve") return { action: "manual_solve" };
  throw make("CaptchaError", "2-я капча за день — аккаунт в cooldown 24h (spec 07)", {
    step: "captcha",
    probe: { countToday },
  });
}

function safeUrl(page) {
  try {
    return page.url();
  } catch {
    return "";
  }
}
