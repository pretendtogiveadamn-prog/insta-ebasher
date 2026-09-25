# DoD — критерии готовой системы рассылки (insta-ebasher-v2)

Дата: 2026-09-25. Принцип: runtime — детерминированный код (никакого LLM в цикле),
вижн — инструмент ОТЛАДКИ и приёмки (глаза owner'а), не часть исполнения.
Авто-проверки: `npm test` (L1) + `ih dood` (гейт) + `ih audit <h> --thread` (live L2).

## A. DOM-слой: резолвер и само-хилинг (анти-самообман)

1. ✅ deepQuery отдаёт flat-кандидатов: tag lowercase, ariaLabel/placeholder/href/name/role/box/ancestors top-level. *(unit: resolver/discovery)*
2. ✅ Динамические классы-жетоны (≥16 симв без дефиса) вырезаются из нормализации. *(unit: dom)*
3. ✅ Mini-CSS парсер: tag/#id/.class/[attr op v i], child/descendant цепочки. *(unit: resolver)*
4. ✅ Запрещённые `:contains`/`:has-text` отвергаются валидатором контрактов. *(unit: contract)*
5. ✅ text-стратегии: exact/prefix/includes + scope по предкам. *(unit: resolver)*
6. ✅ disambig: first_visible/last_visible/nth. *(unit: resolver)*
7. ✅ **Discovery-правила матчат РЕАЛЬНУЮ flat-форму** (регрессия на мёртвые правила 2026-09-24). *(unit: discovery)*
8. ✅ Unique-гард: 2+ сильных матча → heal отказ (лучше miss, чем клик не туда). *(unit)*
9. ✅ Невидимые/disabled кандидаты не хилятся. *(unit)*
10. ✅ `role=state` и `allowDiscovery:false` никогда не хилятся (двойной гард: resolveOnPage + recordDiscovery). *(unit)*
11. ✅ suggestStrategy → re-resolve self-check: предложенная стратегия обязана находить того же победителя. *(unit)*
12. ✅ recordDiscovery idempotent, пишет только pending, verified не трогает. *(unit)*
13. ✅ Анти-фолс-позитив: «Messages» топ-бара ≠ кнопка «Message». *(unit)*
14. ⬜ Все 7 контрактов verified через live-аудит (`--apply` с evidence). *(сегодня, фаза C)*
15. ⬜ Детекторные зоны (action-block/captcha) молчат на здоровых страницах — аудит показывает ⚠️ при ложных сработках. *(audit проверка)*

## B. DM-flow (S0–S10)

16. ✅ Enter = SEND; перенос строки только Shift+Enter (TRAPS #1). *(unit: human)*
17. ✅ Печать по keydown, без fill/insertText (TRAPS #2). *(unit: human/dm)*
18. ✅ S2: exact-handle на профиле (href ИЛИ header, word-boundary) иначе RecipientResolutionError. *(unit: dm)*
19. ✅ Route-детект: Message-кнопка есть → маршрут A; нет → маршрут B (/direct/new/). Оба пути в тестах. *(unit: dm route B; live: audit)*
20. ✅ Route B: exact-ряд в выдаче (первая строка = хэндл), похожие хэндлы отбракованы (deezzo_prod ≠ deezzo_prod3). *(unit + live audit)*
21. ✅ **S5: `/direct/new/` без composer'а ≠ открытый тред** (фикс ложного позитива). Открытие = url `/direct/t/` ИЛИ видимый composer. *(unit: waitThreadOpen ×3)*
22. ✅ **S5: верификация получателя В ТРЕДЕ** — ссылка `/handle/` в pane, fail-closed. *(unit: verifyThreadRecipient)*
23. ✅ Route B: до 2 попыток клика по ряду (координатный клик может не селектнуть). *(код + live)*
24. ✅ DmRestricted — без штрафа аккаунта, лид → dm_restricted. *(unit)*
25. ✅ ActionBlock → cooldown 4/24/72h по счётчику, fail-closed стоп. *(unit)*
26. ✅ ConfirmMiss → needs_manual, НЕ sent; лид в v1 → unknown (не перевыдастся). *(unit)*
27. ✅ confirmSent: DOM (текст+иконка) ИЛИ network ok; «кнопка нажата» ≠ success. *(unit)*
28. ✅ Капча-детект после goto и после открытия треда; 2-я за день → cooldown 24h. *(unit)*
29. ✅ Каждый шаг пишет evidence (скрин + meta), фейл — fail_скрин. *(live: dry-run проверка)*
30. ⬜ Kill-тесты: CDP-краш/прокси-даун → typed error, fail-closed. *(L3 сегодня)*
31. ✅ Прокси fail-closed: нет прокси → нет Chrome. *(unit: gate)*

## C. Mailer-цикл (скриптовая рассылка поверх v1)

32. ✅ v1-гейты: quota / stopReason / blocked / no campaign / active lease → стоп без DM. *(unit)*
33. ✅ IH_CLASSIFY_ONLY=1 блокирует live (двойной гейт: mailer + dm). *(unit)*
34. ✅ canary = строго 1 DM. *(unit)*
35. ✅ outcome-маппинг v2→v1 полный (10 кодов). *(unit: bridge)*
36. ✅ **watchdog на DM** (IH_DM_TIMEOUT_MS, дефолт 8 мин): зависший флоу → uncertain, цикл жив. *(unit)*
37. ✅ **postOutcome retry** 1s→2s→4s; полный сбой → `mailer_outcome_lost` в events (replay вручную). *(unit)*
38. ✅ **TTL lease**: <60с до expiresAt → not_sent + стоп (не стартуем DM на протухающем lease). *(unit)*
39. ✅ Heartbeat 60s; SessionError → login_required, ActionBlock → restricted в v1-панель. *(unit)*
40. ✅ Natural stop (No eligible lead и пр.) корректно отличён от ошибок. *(unit)*
41. ✅ Хвостовой слип убран: после последнего DM цикл не спит. *(код)*
42. ⬜ v1 backend E2E: `ih mail --dry-run` против живого v1 → previewed. *(фаза F)*

## D. Live-приёмка (сегодня, вижн owner'а + мой)

43. ⬜ audit --thread green на levelthreethesis И deezzo_prod (route + recipient подтверждены).
44. ⬜ dry-run 2/2: тред открыт, текст в composer, НЕ отправлено — вижн скринов evidence.
45. ⬜ live canary → levelthreethesis: bubble с текстом в треде (вижн), confirm ok.
46. ⬜ live → deezzo_prod: sent + confirmation-скрин.
47. ⬜ 0 отправок не тому получателю (все S5-верификации в логах).

## E. Гигиена

48. ✅ 0 секретов в коде (dood).
49. ✅ Секреты в state/.env вне git.
50. ✅ Один writer на profileDir (CDP-attach модель Anty).
