# 06 — Фазы и acceptance

## Phase 0 — Каркас + Anty CDP-мост
- **Вход:** репо `C:\Users\MateBook\insta-ebasher-v2`, Anty panel с ADR-001 (уже есть).
- **Работа:** Node 24, package.json, run.mjs + CLI (doctor, accounts, leads, send, stats, dood), core (errors/db/evidence/log/paths) — тащить из ytbot-2; browser/anty.mjs + gate.mjs; миграции spec 04.
- **Артефакты:** каркас, unit-тесты green, `ih doctor` живой.
- **Gate:** L1 green; `ih doctor` показывает панель health + CDP pool; 0 секретов в коде.
- **Эскалация:** если ADR-001-пул занят ytbot-2-профилями — панель сама выдаст свободный (19400–19449 = 50 профилей, хватает).

## Phase 1 — IG DOM live-audit (тестовый аккаунт)
- **Вход:** Phase 0 gate; тестовый Anty-профиль с залогиненным IG-аккаунтом (owner создаёт/указывает).
- **Работа:** selfcheck 7/7; контракт-аудит всех зон (spec 05 L2) на живом аккаунте; golden snapshots; drift-факты в TRAPS.md.
- **Артефакты:** `selectors/*.yaml` (all verified), golden-скрины, отчёт аудита.
- **Gate:** selfcheck 7/7; 100% элементов зон verified; owner оглядел скрины (10 мин).
- **Эскалация:** аккаунт в challenge → owner-решение (не форсить).

## Phase 2 — DM-flow (до live-отправки)
- **Вход:** Phase 1 gate.
- **Работа:** state-machine S0–S10, confirm-логика (DOM+network), action-block detection, evidence per step, unit-тесты на mocked DOM, dry-run-режим.
- **Gate:** dry-run 3/3: тред открыт, текст напечатан, подтверждение «было бы», скрин на каждый шаг; kill-тесты (CDP-краш, прокси-даун) fail-closed.
- **Эскалация:** ConfirmMiss на 3 dry-run подряд → manual.

## Phase 3 — LLM-слой + первые live DM
- **Вход:** Phase 2 gate.
- **Работа:** research/classify/compose + кэш + `IH_CLASSIFY_ONLY`; 20 лидов ручной оценки; первые live DM (start cap 10/день, owner рядом).
- **Gate:** precision dm_worth ≥ 0.8 (20 verdict'ов); 3 consecutive green canary; 3 live DM sent с confirmation-скринами; 0 не-тому-получателю; ресерч-батч: ≥20 candidates, ≥80% с evidence, 0 дублей.
- **Эскалация:** action block на первом же дне → стоп, разбор.

## Phase 4 — Scheduler/daemon + масштаб
- **Вход:** Phase 3 gate, 7 дней reply-rate данных.
- **Работа:** waves, caps-ramp, cooldowns, `ih run` daemon, TG-алерты, `ih stats`.
- **Gate:** 3 авто-батча подряд без ручного вмешательства; chaos-тесты (прокси-даун, chrome-краш) → recovery по спеке; reply-rate ≥ baseline 1.0 (из outreach_log 1.0).
- **Эскалация:** reply-rate ниже baseline 2 недели подряд → разбор compose/classify.

## Phase 5 — Расширение механик (like/follow/comment/profile-view)
- Отдельный ADR по лимитам каждой механики (ресерч: читать медленнее 30–60с/запрос).
- Новые степпы теми же контракт-селекторами; сначала read-only механики (profile-view, like), потом follow/comment.
