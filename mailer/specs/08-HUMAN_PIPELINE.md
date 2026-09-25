# 08 — HUMAN PIPELINE: человекоподобная DM-рассылка Instagram

Статус: draft → owner-review (2026-09-25). Приоритет: неотличимость от человека > скорость > покрытие.
Расширяет: spec 02 (DM-flow). Runtime — строго детерминированный код; LLM/CV в цикле НЕТ.
Вижн (scripts/vision.mjs) — только отладка и приёмка evidence.

## 0. Принципы

1. Ноль робо-переходов в основном пути: навигация = клики по UI (левый сайдар, поиск, кнопки). `page.goto` — аварийный degraded-mode с WARN-метрикой `degraded_nav_total` (цель: 0).
2. Один цикл = сессия живого пользователя: лента → поиск → профиль → чтение → мини-чат → лента → скролл 3–6 мин.
3. Строгие post-условия на каждом шаге: «кликнул» ≠ «получилось»; неопределённость = `UNKNOWN`, не успех.
4. Fail-closed: прокси/капча/action-block/неоднозначный селектор/неизвестный экран → стоп с причиной.
5. Анти-самообман: unique-гард резолвера, discovery только предлагает pending-стратегии, детекторные зоны не должны срабатывать на здоровых страницах (аудит показывает ⚠️).

## 1. Живые улики (evidence 2026-09-25, Anty-профиль ee976e65, аккаунт polynoire01)

- Splash IG за резидентным прокси грузится долго: domcontentloaded ≠ контент; скелетон мини-чата — 5–10с. Все ожидания — readiness-предикаты, не фиксированные слипы. *(audit-levelthreethesis-1790326787090: 225 кандидатов на скелетоне)*
- Клик Message на профиле → **мини-чат 440×650 в правом нижнем углу, URL не меняется** (owner + minichat-deezzo_prod-1790328875932). Это ОСНОВНОЙ путь (route A).
- Мини-чат DOM: НЕ `role=dialog` (просто div-стек); composer = `div[role='textbox']` — **уникален на странице профиля** (box x≈935, y≈737); header попапа = `a[href='/{handle}/']` с display-name; кнопки «развернуть» и «✕».
- Часть профилей без кнопки Message (deezzo_prod3) → route B через Direct. Из /direct/new/ клик по exact-ряду открывает `/direct/t/<id>/` сразу (кнопки Chat нет).
- `/direct/new/` БЕЗ выбранного получателя матчится regex `/direct/` — ложный «тред открыт» (фикс 2026-09-25: waitThreadOpen).
- У deezzo_prod есть история переписки → дубль-чек истории обязателен (S9).

## 2. State machine S0–S16

| # | Состояние | Действие | Post-условие (обязательное) | Бюджет |
|---|-----------|----------|------------------------------|--------|
| S0 | BOOT_ATTACH | CDP-attach, прокси/IP-gate | IP = профилю; иначе F_PROXY | 30с |
| S1 | SESSION_GATE | детект залогина (сайдбар nav) | nav есть, нет login-формы; капча → F_CAPTCHA | 45с |
| S2 | TARGET_ACQUIRE | lease v1 (handle+text) ИЛИ lead из v2-очереди (standalone) | TTL lease > 10 мин, иначе skip+not_sent | 60с |
| S3 | HOME_READY | readiness ленты | сайдбар + ≥1 `main article` (или детект пустой ленты) | 60с |
| S4 | NAV_SEARCH | hover → клик Search в сайдбаре | панель поиска открылась (input виден) | 20с |
| S5 | SEARCH_TYPE | посимвольный ввод хэндла | input == handle; выдача появилась | 30с |
| S6 | SEARCH_PICK | клик exact-ряда | url `/handle/` ИЛИ profile header == handle | 30с |
| S7 | PROFILE_READY | readiness + route-детект | header exact-match; route=A (Message есть) / B (нет за 8с — ветвление, не ошибка) | 40с |
| S8 | OPEN_CHAT | A: клик Message → **мини-чат**; B: сайдбар Direct → New message → picker → exact-ряд | race-детект: minichat-root (header link exact) ИЛИ `/direct/t/` + composer | 40с |
| S9 | RECIPIENT_VERIFY | сверка + дубль-чек | header/link == handle exact (TRAPS #5); последний исходящий пузырь не <24ч и не == тексту кампании → иначе SKIP_DUPLICATE | 15с |
| S10 | COMPOSE | фокус composer, dwell, посимвольный ввод | composer innerText == text (норм. whitespace) | 5с/симв max |
| S11 | SEND_VERIFY | Enter; подтверждение | bubble с хвостом текста ИЛИ network 2xx; composer очищен. Иначе UNKNOWN — **пересылка запрещена** | 30с |
| S12 | POST_SEND_LINGER | «чтение» треда, лёгкая мышь | — | 6–15с |
| S13 | CLOSE_CONTEXT | мини-чат: крестик; /direct/t/: no-op | minichat-root исчез из DOM | 10с |
| S14 | REPORT | outcome в v1 (sent/skipped/failed/unknown) ИЛИ v2 outreach_log (standalone) | ack; retry 1s→2s→4s; сбой → outcome_lost событие | 60с |
| S15 | LEAVE_HOME | клик Home-иконки сайдбара (bezier) | readiness ленты как S3 | 30с |
| S16 | FEED_COOLDOWN | кд на ленте + скролл | таймер кд истёк; heartbeat 60с | 180–360с |

Fail-состояния (все fail-closed): F_PROXY (IP mismatch), F_CAPTCHA (глобальный watcher), F_ACTIONBLOCK (cooldown 4/24/72ч), F_SESSION_LOST, F_AMBIGUITY (>1 кандидата после disambig), F_CONTRACT_DRIFT (0 кандидатов после retry-лестницы), F_UNKNOWN (нет подтверждения — НЕ ретраим).

Глобальный watcher (капча/action-block/login-форма/action-toast) активен в КАЖДОМ состоянии и на каждом тике readiness-поллинга.

Watchdog на DM-цикл (8 мин) покрывает S0–S15; S16 — длинное состояние: heartbeat 60с + progress-ping на входе/выходе (watchdog сбрасывается).

## 3. Навигация: приоритет путей

| Приоритет | Путь | Условия |
|-----------|------|---------|
| P1 основной | Search UI: сайдбар Search → ввод хэндла → exact-ряд → профиль | контракты nav/search verified |
| P2 fallback | «Ручной» URL: Ctrl+L → посимвольный ввод (70–160мс/симв) → Enter. Детект: url ^/handle/ + header==handle за 10с, иначе Esc → P1 | после live-спайка (риск: omnibox-фокус через CDP не гарантирован; автокомплит) |
| P3 degraded | page.goto + пред-пауза 2–5с | провал P1 и P2; WARN-метрика |

S15 уход на главную — ВСЕГДА P1-клик по сайдбар-Home (никогда goto).

## 4. Мини-чат — модель

1. S8 = race-детект: minichat-root (div-стек с `a[href='/{handle}/']` внутри + contenteditable) ИЛИ `/direct/t/`. Первый сработавший предикат побеждает.
2. Стек мини-чатов: выбор root ТОЛЬКО по exact header-link хэндла, никогда по позиции.
3. Реюз: уже открытый мини-чат с этим handle переиспользуем (не открываем дубль).
4. Composer scoped ВНУТРИ выбранного root (анти-FP с composer'ом /direct страницы).
5. S13 закрывает мини-чат крестиком (post-условие: root исчез); /direct/t/ не закрываем — уходим Home.
6. Узкий вьюпорт/A-B: Message может вести на /direct/t/ — race-детект покрывает. Вьюпорт профиля фиксируем 1280–1440.

## 5. Контракты: новые зоны (pending → live-аудит → verified)

- `contracts/nav.yaml` — sidebar: home `a[href='/']` (disambig: не логотип — с span-потомком), direct `a[href*='/direct']`, search `[aria-label]` мультисловарь + post-валидация поведением (панель открылась). Приоритет href над текстом (локализация!).
- `contracts/search.yaml` — panel (панель поиска), input (textbox в panel, unique), row (`a[href='/{handle}/']` + textContent lowercase == handle; НИКАКИХ startsWith — ловушка deezzo_prod/deezzo_prod3).
- `contracts/minichat.yaml` — root (структурный: содержит header-link И contenteditable), header_link, composer `[contenteditable]` внутри root, close (aria Close/Закрыть; не expand; post-валидация: root исчез).
- `contracts/feed.yaml` — article `main article` (≥1), spinner absent.
- Существующие: profile (header_username, profile_message_button с exclude Follow/Following), direct-new (route B), thread, send-confirm, action-block, captcha, login — без переименований.

Discovery-правила для новых зон: только с unique-гардом; state-элементы не хилятся.

## 6. Тайминги (сэмплы из диапазонов, seeded RNG)

| Шаг | Диапазон |
|-----|----------|
| hover перед кликом (bezier-подвод) | 0.4–1.2с |
| после post-условия → следующий шаг | 0.8–2.5с |
| ввод хэндла/текста | 60–180мс/симв + burst-паузы 300–600мс каждые 3–7 симв |
| «смотрю на выдачу» перед кликом ряда | 1.0–2.8с |
| чтение профиля до Message | 4–12с + лёгкий скролл 0–2 раза |
| сверка получателя | 1.5–3.5с |
| перед Enter (перечитал) | 1.5–4с |
| linger после отправки | 6–15с |
| **кд между DM** | **Beta(2,2) → [180,360]с, медиана ≈270с** |
| скролл ленты в кд | wheel 400–900px, паузы 1.5–4с, 5–10% шанс dwell 8–15с |

Опечатки/стирания выключены (текст финален, риск искажения > реализм).
Сутки: cap 30 DM/день (старт 20, рост ≤+20%/день), фактический cap дня = cap×U(0.9,1.0); длинный перерыв 10–20 мин после каждых 5–8 DM; окно 09:30–22:30 по гео-прокси; сон ≥7ч. Скорость ≈7–8 DM/час — простои НЕ компенсируем ускорением.

## 7. Retry-политики

| Ситуация | Политика |
|----------|----------|
| поиск без exact-ряда | select-all+delete, повтор ×1 → target_not_found (похожие НЕ кликаем) |
| клик Message без эффекта | пере-детект route, ×1 → route B |
| send без подтверждения | 1 повтор ТОЛЬКО если composer не пуст ∧ bubble точно нет; иначе UNKNOWN |
| readiness таймаут | продлить ×1 → reload ×1 → F_CONTRACT_DRIFT/F_PROXY |
| lease TTL истёк до S11 | abort + not_sent; после S11 — завершить report |

## 8. Тестируемость

- Unit: resolver-фикстуры (стек мини-чатов по handle, exact-row, логотип vs Home, exclude Follow), сэмплер таймингов (диапазоны/медиана/seedable), state machine (разрешённые переходы, property: из любого состояния достижим F\*/END), scheduler (cap/джиттер/окно/heartbeat), post-conditions pass/fail/UNKNOWN.
- Live: `ih audit` переводит новые зоны pending→verified на аккаунтах обоих типов раскладки; спайк Ctrl+L (P2); dry-run до S10 с SEND_ARMED=false; канарей 1 аккаунт 3–5 DM/день.
- Вижн-приёмка: скрин-бандл на каждый F-state и S11 (до/после Enter). DoD — docs/DOD.md (50 критериев).

## 9. Риски

| Риск | Митигация |
|------|-----------|
| Message → /direct/t/ вместо мини-чата (A/B, вьюпорт) | race-детект S8; фикс-вьюпорт |
| Дубль-DM после неявного успеха | UNKNOWN ≠ retry; S9 дубль-чек; v1 dedupe по leadId |
| Дрейф DOM IG | pending→verified только аудитом; unique-гард fail-closed; канарей-аудит перед батчем |
| Прокси-лаги/splash | readiness-предикаты, таймауты P95×2, IP fail-closed |
| Ctrl+L недоступен через CDP | P2 опционален; P1 основной |
| Локализация ломает текст-стратегии | href/role приоритет, мультисловари, неизвестная локаль → F_CONTRACT_DRIFT |
| Стек мини-чатов, перепутан получатель | root по exact header-link, реюз, S13 закрывает свой |
| Метроном-интервалы (поведенческий фингерпринт) | Beta-распределения, длинные перерывы, окно, джиттер cap |

## 10. Открытые вопросы к owner

1. DAILY_CAP финальный (в спеке 20→30 ramp) и окно активности.
2. v1 lease TTL ≥12 мин? (цикл с кд ≈8–9 мин) — или standalone без v1 на сегодня.
3. Спайк Ctrl+L — после реализации.
