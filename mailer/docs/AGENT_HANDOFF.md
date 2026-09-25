# AGENT_HANDOFF — вход для исполняющего агента

## 5 минут
1. Прочитай `README.md` (стек, инварианты, структура).
2. Прочитай `specs/00` → `06` по порядку.
3. Прочитай `docs/TRAPS.md` (ошибки 1.0) и `docs/RESEARCH-2026-09-19.md` (внешний контекст: лимиты, антидетект).
4. `ih doctor` (после Phase 0) — живость панели/CDP/proxy/db.

## Ключевые факты
- **v1 (`D:\codexprojects\insta-ebasher`)** — CRM/квоты/панель/TG; источник фич. Читаем его `docs/04_BACKEND_CONTRACT.md`, `02_CRM_AND_STATES.md`, `03_AGENT_PROTOCOL.md`. V2 не пишет в его БД напрямую — только через API/contracts.
- Панель Anty: `D:\patchright-recovery\anty\`, port 3200, token в `state/.env` (ANTY_TOKEN). CDP pool 19400–19449 (ADR-001 уже применён, backup `server.mjs.bak-adr001`).
- Тестовый аккаунт для Phase 1: **owner укажет** (тестовый Anty-профиль с залогиненным IG). Основной аккаунт beat-recovery НЕ трогать (он в проде на VPS).
- Переиспользование: `C:\Users\MateBook\ytbot-2\src\browser\{anty,gate}.mjs` + core; `C:\Users\MateBook\gmail-farm\engine\human.mjs`; логика IG-DOM — `D:\codexprojects\beat-recovery\src\sender\` (читать, переносить в .mjs, не импортировать TS).
- Старый sender (1.0): `D:\codexprojects\beat-recovery`, прод на VPS `81.26.186.55` — НЕ трогать, пока идёт Phase 0–3.

## Правила
- rm -rf — только с разрешения. Профили Anty — только через панель API.
- Один writer на profileDir.
- Секреты: `state/.env` (вне git).
- Fail-closed: нет прокси → нет Chrome; нет exact-получателя → нет DM; нет LLM-вердикта → нет DM.
- Gate каждой фазы — из `specs/06-PHASES.md`. Не перескакивать.
