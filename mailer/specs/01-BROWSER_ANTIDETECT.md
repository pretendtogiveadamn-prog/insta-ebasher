# 01 — Браузер и антидетект (Anty CDP-attach)

## 1. Модель attach
- Anty panel `http://127.0.0.1:3200` — единственный owner/launcher Chrome. АDR-001 уже даёт `cdpPort` (pool 19400–19449) в API.
- `browser/anty.mjs`: `profiles()`, `profile(id)` (с `cdpPort`), `open(id)`, `close(id)`, `ensureAttachable(id)`:
  - running + cdpPort жив → attach (`chromium.connectOverCDP(http://127.0.0.1:<cdpPort>)`).
  - не running → `open(id)` → poll до живого CDP (fail-closed при `ok:false` — например proxy gate панели).
  - running но CDP мёртв → ошибка (не re-open) — инвариант «один writer».
- Attach = `connectOverCDP` → выбрать/создать context с profileDir Anty (уже залогинен, fp-профиль, прокси из панели).
- **Никогда** не `launch()` — fingerprint/locale/tz/IP-lock аргументы даёт панель.

## 2. Fingerprint-selfcheck (до первого действия, 7 пунктов)
Запускается на профиль-песочнице перед Phase 2 (аналог ytbot-2 selfcheck):
1. `navigator.webdriver` === undefined/false
2. IP: geo = целевая страна (US) + `web` endpoint (iphey/api), IP ≠ IP машины
3. WebRTC: локальный IP не утекает (policy disable_non_proxied_udp — панель ставит)
4. UA / locale / timezone = значения профиля панели
5. Canvas/WebGL hash = baseline профиля (зафиксировать при первом selfcheck; дрифт → алерт)
6. `chrome.runtime` существует, `navigator.plugins` не пуст, `languages` совпадает с locale
7. Screenshot-снапшот страницы sannysoft/areyouheadless (в evidence, визуальный check)
Код: `selfcheck <anty-profile-id>` — 7/7 = pass. До 7/7 никаких live-отправок.

## 3. Humanizer (`browser/human.mjs`)
Базовый источник — `gmail-farm/engine/human.mjs`, сверить с `beat-recovery/src/sender/human-interaction.ts`:
- **Мышь**: bezierPath (кубическая кривая, 3-6 контрольных точек), hover 80–250ms до клика, клик по случайной точке внутри элемента.
- **Печать**: typingPlan по символу 70–190ms + паузы 300–900ms на пробелах/пунктуации + редкие «раздумья» 1.5–3s. Кладётся по настоящим `keydown`-событиям (не `insertText`/paste — правило антидетекта).
- **Перенос строки** = `Shift+Enter` (Enter в IG-composer = SEND. Готча 1.0, TRAPS beat-recovery).
- **Dwell** на страницах: профиль 3–8s перед действием, 2–5s между шагами, linger 0.8–2.2s перед уходом.
- **Scales**: `YTBOT_TIME_SCALE`-аналог `IH_TIME_SCALE` (0.1 для тестов).
- **Scroll** перед кликом на дальние элементы.

## 4. Прокси
- Proxies из профиля Anty (панель сама держит upstream-forwarder) — бот **не** дублирует прокси-слой.
- `browser/gate.mjs`: precheck IP (geo + latency < 2000ms) до старта сессии; кэш результата 6ч; fail-closed при ошибке probe.
- **1 аккаунт = 1 IP = одна сессия целиком.** Ротация mid-action запрещена (login-checkpoint, ресерч r/IGautomations 2026). Смена IP → только между сессиями (закрыть контекст, сменить прокси в панели, новый open).
- Datacenter IP = смерть (ресерч) — в gate проверяем тип (residential/mobile по provider-metadate или geo-сервису).

## 5. Session lifecycle
- Context живёт не более **12ч** (MAX_CONTEXT_AGE из 1.0) → recycling: close в панели, новый open.
- Crash/hang Chrome (CDP мёртв) → close+open один раз; второй раз → `SessionError`, стоп аккаунта.
- Off-screen vs видимое: для DM — headed-окно (видимое или off-screen с анти-throttle-флагами панели); логин — всегда видимое.

## 6. Selfcheck-команда
`ih selfcheck <profile>` → таблица 7 пунктов + evidence. `ih doctor` → панель health, CDP pool, proxy gate, SQLite, LLM-креды.
