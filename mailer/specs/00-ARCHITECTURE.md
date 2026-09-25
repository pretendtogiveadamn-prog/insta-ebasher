# 00 — Архитектура

## Решение ADR: v2 = движок поверх v1 (2026-09-19, owner)
- **`D:\codexprojects\insta-ebasher` (v1) — источник фич и CRM**: leads/states, leases, квота 35 DM/24h, панель, TG-алерты, research/inbox-контракты — не дублируем.
- **v2 (`C:\Users\MateBook\insta-ebasher-v2`) — новый браузерный движок + LLM-слой**: заменяет «Codex-агент рулит Chrome через MCP» на детерминированные patchright-скрипты + LLM-мозг. Подключается к v1 через его API (leases/outcomes), не через БД напрямую.
- Две фичи, которые должны пиздато работать в любом кейсе: **ресерч** (найди артистов, использующих наши биты) и **рассылка** (первый DM от одобренного лида + ответы).
- Пока v1-API не готов под движок — v2 работает автономно (свои SQLite), контракт интеграции описан ниже (поверх `docs/04_BACKEND_CONTRACT.md` v1).

## Принципы
1. **Гибрид LLM-мозг / browser-руки.** LLM решает «кого и что написать», браузер только исполняет фиксированные степпы. LLM не в цикле механики — детерминизм + дешёвость.
2. **Один анти-слой.** Anty panel = единственный владелец Chrome и источника fingerprint. Бот attach'ится по CDP, не запуская браузер (модель ytbot-2 / ADR-001).
3. **Переиспользование, не переизобретение.** Браузерный слой, humanizer, proxy-gate, evidence, typed errors — та же архитектура, что в `ytbot-2` и `gmail-farm`. Не плодить 4-й вариант.
4. **Fail-closed везде.** Нет прокси → нет Chrome. Нет exact-получателя → нет отправки. Action block → стоп.
5. **Телеметрия = источник правды.** Цифры лимитов калибруем своими outcomes, не форумами.

## Слои
```
[insta-ebasher v1: CRM, leases, квоты, панель, TG]
   │  API (lease -> action -> outcome)
CLI / UI (опц.)
   │
orch      scheduler, accounts, daily-caps, cooldowns, waves
   │
flows     dm-flow state-machine, verify, evidence
   │
llm       research → classify → compose (вне механики, кэш по профилю)
   │
browser   anty CDP-attach, proxy gate, humanizer, selfcheck
   │
core      errors (typed), db (node:sqlite), evidence, log, paths
   │
Anty panel (127.0.0.1:3200, CDP pool 19400-19449) → system Chrome
```

## Компоненты
- **core/errors.mjs** — типизированные ошибки: `ProxyError`, `SessionError`, `RecipientResolutionError`, `DmRestrictedError`, `ActionBlockError`, `ConfirmMissError`, `LlmError`. Каждая несёт `code`, `retriable`, `step`, `evidence`.
- **core/db.mjs** — SQLite: `accounts`, `leads`, `outreach_log`, `llm_cache`, `cooldowns`.
- **core/evidence.mjs** — скриншоты/DOM-снапшоты per (lead, step), retention.
- **browser/anty.mjs** — CDP-attach к Anty (порт из API), health, ensureAttachable.
- **browser/gate.mjs** — proxy gate: geo=US/цель + latency, fail-closed, кэш 6ч.
- **browser/human.mjs** — humanizer (bezier-мышь, typing по символу, джиттер).
- **flows/dm.mjs** — state-machine S0→Sn отправки.
- **flows/verify.mjs** — жёсткое post-условие подтверждения.
- **llm/research.mjs, classify.mjs, compose.mjs** — ресерч/класс/генерация + кэш.
- **orch/scheduler.mjs** — pacing (мин/макс задержка), daily caps, cooldowns, waves.

## Что переиспользуем
| Источник | Компонент | Как |
|---|---|---|
| `ytbot-2/src/browser/anty.mjs` | CDP-attach, ensureAttachable | прямо (модель Anty та же) |
| `ytbot-2/src/browser/gate.mjs` | proxy gate | прямо |
| `gmail-farm/engine/human.mjs` | humanizer | прямо |
| `gmail-farm/engine/device_fp.mjs` | fp-самопроверка | адаптировать |
| `beat-recovery/src/sender/instagram-sender.ts` | IG-DOM: openMessageThread (3-проход), verify handle, action-block patterns, send confirm | **перенос логики** в .mjs + контракт-селекторы |
| `beat-recovery/src/sender/human-interaction.ts` | bezier/typingPlan | сверить с gmail-farm human.mjs, взять лучшее |
| `ytbot-2` core (errors/db/evidence/log/paths) | каркас | прямо |

## Что НЕ тащим (scope-out)
- Mobile/emulator/Appium — нет мобилок, web-only. Фолбэк = mobile 4G/5G прокси + снижение темпа.
- Full LLM-агент на механику — дорого/нестабильно.
- API-скрапинг (instagrapi) — не writer; только доп read-канал позже.
- Ответы/реплики (reply-tracking) — фаза после DM-MVP.

## Качество двух фич (критерии «пиздато в любом кейсе»)
**Ресерч:**
- Источники: наш каталог битов (YT) → поиск по платформам (ArtistConnect-парсер из beat-recovery: Firestore runQuery через залогиненный профиль), Instagram Search по бит-названиям/тегам, ручные сиды.
- Каждый кандидат = evidence (скрины/факты: где используется наш бит, дата поста), не «нашёл и всё».
- Вердикт LLM (релевантность/категория/активность) + review-гейт (owner или delegated-auto по порогу, как v1: artist/80+/100+).
- Дедуп: один артист = одна CRM-запись (правило v1).

**Рассылка:**
- Только approved-лиды, только через lease (один таргет на lease — контракт v1).
- Жёсткое подтверждение (spec 02), exact-handle (spec 02), персональный текст (spec 03), квота ≤35/24h (v1), reply-capture + TG-алерт.
- Outcomes пишутся только через backend (правило v1: `sent` — факт только после принятия backend'ом).

## Ошибки и статусы
Единый каталог кодов. Каждый step-вызов wrap'ит в типизированную. `retriable` только для Transient/Proxy/Api. ActionBlock/DmRestricted — НЕ retriable без cooldown.
