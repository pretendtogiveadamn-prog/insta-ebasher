# insta-ebasher-v2 — краткий runbook

## CLI (`ih`, через run.mjs)

```bash
node --env-file=state/.env run.mjs doctor          # панель/CDP pool/sqlite/llm-креды
node --env-file=state/.env run.mjs selfcheck <profile>   # 7 пунктов fp (Phase 1)
node run.mjs accounts add --anty-profile <id> --username @x --cap 25
node run.mjs accounts list
node run.mjs leads add --handle @artist --artist "Artist" --track "Track"
node run.mjs classify --limit 20                   # LLM-слой: research→classify→compose (не шлёт)
node run.mjs send --lead-id <id> --dry-run         # DM-flow до S8 CONFIRM без отправки
node run.mjs send --canary <leadId>                # canary: полный флоу (требует verified)
node run.mjs stats --days 7
node run.mjs dood                                  # DoD-гейт
```

## Гейты (fail-closed, спека 00/02/06)
- **live `send`** требует verified-контрактов (все 19 элементов 6 зон). Пока pending — только `--dry-run` / `--canary` по факту тоже live-gated.
- **DM не уйдёт** без: lead в `ready` (LLM-вердикт), exact-handle (S2), подтверждения DOM/network (S8), прокси-gate (US), капча-гейта.
- `IH_CLASSIFY_ONLY=1` (дефолт) — classify не шлёт ничего.

## Что ждать от live-тестов (Phase 1+)
1. `selfcheck` на тестовом Anty-профиле → 7/7 (первый прогон пишет canvas-baseline)
2. Контракт-аудит: selectors через audit-скрипты → verified в contracts/*.yaml (at+evidence)
3. `send --dry-run` 3/3 green → canary → live (cap 10/день, owner рядом)
