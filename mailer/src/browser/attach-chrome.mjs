// attach-chrome.mjs — клиентский режим БЕЗ Anty: обычный Chrome клиента с --remote-debugging-port.
// Тот же CDP-протокол, тот же humanizer/flows — отличается только способ получения порта.
// Активируется env IH_CHROME_CDP=<port> (дефолт 9222). Профиль: отдельный user-data-dir (start-chrome.bat).
import { attachCdp } from "./attach.mjs";

export const DEFAULT_CHROME_CDP_PORT = 9222;

export function chromeModeEnabled(env = process.env) {
  // явный порт ИЛИ просто нет ANTY_TOKEN (у клиента нет state/.env) → chrome mode 9222
  if (env.IH_CHROME_CDP) return true;
  return !env.ANTY_TOKEN;
}

export function chromeCdpPort(env = process.env) {
  return Number(env.IH_CHROME_CDP) || DEFAULT_CHROME_CDP_PORT;
}

export async function attachLocalChrome({ port = DEFAULT_CHROME_CDP_PORT, newTabUrl = "https://www.instagram.com/", maxOwnTabs = 3 } = {}) {
  const r = await attachCdp({ cdpUrl: `http://127.0.0.1:${port}`, markerId: "local-chrome", newTabUrl, maxOwnTabs });
  return { ...r, profile: { id: "local-chrome", cdpPort: port }, openedByBot: false };
}

// Единая точка выбора attach-имплементации: Anty (у нас) или Chrome клиента (по env).
export function makeAttach({ env = process.env } = {}) {
  if (chromeModeEnabled(env)) {
    const port = chromeCdpPort(env);
    return (_client, _profileId, opts = {}) => attachLocalChrome({ port, newTabUrl: opts.newTabUrl ?? "https://www.instagram.com/" });
  }
  return null; // caller использует дефолтный attachProfile (Anty)
}
