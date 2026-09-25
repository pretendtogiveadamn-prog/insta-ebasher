// verify.mjs — жёсткое post-условие подтверждения DM (spec 02 §3).
// «Нажал кнопку» ≠ «DM ушёл». Success = DOM-текст в ленте + статус-иконка,
// ИЛИ network-ответ send ok. Timeout 15с → ConfirmMissError (retriable=false).
import { make } from "../core/errors.mjs";

export const CONFIRM_TIMEOUT_MS = 15000;

// DOM-подтверждение: наш текст присутствует в треде, а в composer его уже НЕТ
// (пузырь появляется только после реальной отправки). Статус-иконка Sent — бонус,
// в мини-чате она не рендерится (evidence dm-b1a6c750-1790333116557).
// Сравнение — по буквенно-цифровому скелету: IG (1) переносит строки в пузыре (\n),
// (2) рендерит эмодзи как <img> без текста — innerText их пропускает (баг dm-6b516d6b-1790333859427).
const skel = (s) => String(s ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
export function domConfirmMatches(pageData, draftText) {
  const hasDraft = skel(pageData?.threadText).includes(skel(draftText));
  const inComposer = Boolean(pageData?.inComposer);
  const statusOk = Boolean(pageData?.statusIcons?.some?.((s) =>
    ["Sent", "Delivered", "Seen", "Отправлено", "Доставлено", "Просмотрено"].includes(String(s))
  ));
  if (!hasDraft) return { ok: false, reason: "draft text not in thread" };
  if (inComposer) return { ok: false, reason: "draft still in composer (не отправлено)" };
  return { ok: true, reason: statusOk ? "dom confirmed (text+icon)" : "dom confirmed (bubble, no icon)" };
}

// Сбор данных треда со страницы (Playwright page или мок)
export async function collectThreadData(page, draftText) {
  return await page.evaluate((needle) => {
    const root = document.body;
    const text = root ? root.innerText ?? root.textContent ?? "" : "";
    const icons = new Set();
    for (const svg of document.querySelectorAll("svg[aria-label]")) {
      icons.add(svg.getAttribute("aria-label"));
    }
    // драфт ещё в composer (div[role=textbox])? тогда Enter не прошёл — НЕ считаем отправленным
    const needleSkel = String(needle).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const inComposer = [...document.querySelectorAll("div[role='textbox']")].some((el) =>
      String(el.textContent ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").toLowerCase().includes(needleSkel)
    );
    return { threadText: text, statusIcons: [...icons], inComposer };
  }, draftText);
}

// Network-подтверждение: слушаем response'ы с ok:true на send-эндпоинтах.
// attach до клика send; resolve() при первом валидном ответе.
export function attachNetworkConfirm(page) {
  const state = { ok: false, detail: null };
  const handler = (response) => {
    try {
      const url = response.url() ?? "";
      // реальный send-эндпоинт IG web: /api/v1/direct_v2/threads/broadcast/... (2026-09-25)
      if (!/instagram\.com\/.*(send|DirectMessaging|direct_v2\/.*broadcast)/.test(url)) return;
      response.json().then((j) => {
        const okFlag = j?.ok === true || j?.status === "ok" || j?.payload?.status === "ok";
        if (okFlag && !state.ok) {
          state.ok = true;
          state.detail = { url, at: Date.now() };
        }
      }).catch(() => {});
    } catch {}
  };
  page.on?.("response", handler);
  return {
    state,
    detach() {
      try {
        page.off?.("response", handler);
      } catch {}
    },
  };
}

// Полное подтверждение: ждём DOM или network до timeout. Строгое: нужно ≥1.
export async function confirmSent({ page, draftText, netConfirm = null, timeoutMs = CONFIRM_TIMEOUT_MS, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (netConfirm?.state?.ok) return { ok: true, via: "network", detail: netConfirm.state.detail };
    const data = await collectThreadData(page, draftText);
    const dom = domConfirmMatches(data, draftText);
    if (dom.ok) return { ok: true, via: "dom", detail: dom };
    await sleepFn(500);
  }
  const lastDom = domConfirmMatches(await collectThreadData(page, draftText), draftText);
  throw make("ConfirmMissError", `подтверждение не получено за ${timeoutMs}ms (${lastDom.reason})`, {
    step: "S8_confirm",
    probe: { dom: lastDom, networkOk: netConfirm?.state?.ok ?? false },
  });
}
