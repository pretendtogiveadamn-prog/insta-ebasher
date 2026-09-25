# 05 — Тестирование

## L1 — Unit (node:test, без браузера/сети)
- db: миграции, статус-constraints (leads.status, outreach_log.outcome enum)
- errors: каталог кодов, retriable-флаги
- handleTextMatches: word-boundary match (port из 1.0, все edge-кейсы: @, подстроки, unicode)
- limits/cooldowns: расчёт caps из outreach_log, cooldown-расширение
- scheduler: claim-логика (FIFO, без дублей handle), stagger, jitter
- llm: prompt-версии, кэш-key (стабильный hash), parsing structured-ответа, fail на мусоре
- human: typingPlan (длительности, паузы, \n=Shift+Enter в плане), bezier (монотонность, конец на цели)
- evidence/paths/retention

## L2 — Контракт-аудит IG DOM (аналог Phase 1 ytbot-2)
- Зоны: profile (bio, followers, posts-grid), message-button, search-results, thread/composer, send-confirm, action-block-страницы
- Для каждого элемента: контракт (aria/role/text/data-атрибуты + `avoid`-слова), статус pending→verified на живом песочнице-аккаунте, golden-screenshot.
- Аудит — на **тестовом аккаунте** (не основного), dry-run-режим: открыть тред и НЕ отправить.
- Drift-факты (что сломалось за время 1.0) — в `docs/TRAPS.md`.

## L3 — Canary
- `ih send --canary <lead>`: полный флоу до CONFIRM на одном лиде, скрин каждого шага, owner-оглядка.
- 3 consecutive green canary = gate Phase 3.

## L4 — E2E (с живыми аккаунтами, днём)
- 3 DM на тестовом аккаунте → 3× sent + confirmation evidence; reply-rate наблюдение 7д.
- Kill-тесты: убить CDP mid-flow (recover+manual), прокси-даун (fail-closed), challenge-страница (cooldown).
- 2 ошибки подряд → manual_needed сработал.

## DoD-харнесс `ih dood`
Пер-фазовые machine-checkable проверки (как gmail-farm/ytbot-2): L1 green, audit verified% по зонам, canary-статусы, caps-конфиг. 100% gate до перехода фазы.
