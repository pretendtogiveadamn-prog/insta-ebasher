// handleTextMatches — перенос из 1.0 (instagram-sender.ts). Word-boundary match
// handle'а в тексте: с "@" префиксом (левая граница гарантирована "@") и bare
// (обе границы). Правило exact-handle: не совпало точное — RecipientResolutionError,
// никогда не «похожий аккаунт» (TRAPS #5).
const IS_HANDLE_CHAR = (c) => c !== undefined && /[a-z0-9._]/.test(c);

export function handleTextMatches(text, handle) {
  const lower = String(text).toLocaleLowerCase();
  const handleLower = String(handle).toLocaleLowerCase();
  if (!handleLower) return false;
  for (const needle of ["@" + handleLower, handleLower]) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      const leftOk = needle[0] === "@" || !IS_HANDLE_CHAR(lower[idx - 1]);
      const rightOk = !IS_HANDLE_CHAR(lower[idx + needle.length]);
      if (leftOk && rightOk) return true;
      from = idx + 1;
    }
  }
  return false;
}

// exact-handle проверка профиля: то, что вернул verify-step, должно совпасть
// побуквенно (не как текст-поиск, а как строгий slug-compare)
export function isExactHandle(profileHandle, expected) {
  const norm = (s) => String(s ?? "").trim().replace(/^@+/, "").toLocaleLowerCase();
  return norm(profileHandle) === norm(expected);
}

// ACTION_BLOCK_PATTERNS — перенос из 1.0 + challenge/suspension (spec 02).
// НЕ включаем /try again later/i — слишком широко (урок 1.0).
export const ACTION_BLOCK_PATTERNS = [
  /we restrict certain activity to protect our community/i,
  /you'?re temporarily blocked/i,
  /action blocked/i,
  /временно заблокирован/i,
  /мы ограничили некоторые действия/i,
  /check your connection/i,
];

export function detectActionBlockText(text) {
  for (const p of ACTION_BLOCK_PATTERNS) {
    if (p.test(text)) return p.source;
  }
  return null;
}

// Suspended-account redirect — аккаунт сам приостановлен (не action-block)
export function isAccountSuspendedUrl(url) {
  return /\/accounts\/suspended\//.test(String(url ?? ""));
}

// Challenge/капча-детект (spec 07): URL /challenges/ или photo-grid/modal
export function isChallengeUrl(url) {
  return /\/challenges\//.test(String(url ?? ""));
}
