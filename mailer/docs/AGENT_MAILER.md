# AGENT_MAILER — runbook рассылки скриптом (v2-движок поверх v1)

Дата: 2026-09-24. Статус: Phase 1-2 (код + юнит-тесты). Live — после Phase 3 (Anty-профиль + контракт-аудит).

## Идея (ADR v2-over-v1)

Агент (LLM) делает в v1 всё «умное»: research → candidates → ревью/апрув → кампания approve.
Механику (DM через браузер) делает **скрипт** `ih mail`: он клиент v1 lease-протокола.

```
агент:  research + ревью + campaign approve (v1 API, как сегодня)
        ↓ одна команда
        ih mail --v1 http://127.0.0.1:3000 --account <id> [--max N] [--dry-run]
        ↓
скрипт: heartbeat(60s) → state → lease (v1 сам выбрал хэндл + отрендерил текст)
        → dm-flow S0-S10 через Anty CDP-attach → POST outcome → следующий lease
        → стоп (квота/нет лидов/action_block/капча) → summary-отчёт
```

## Что НЕ делает скрипт (by design)

- не выбирает получателя — только цель из outreach-lease v1
- не пишет текст — только message из lease (v1 рендерит template)
- не обходит квоты: v1 35/24h + v2 daily_cap на аккаунт, оба fail-closed
- не шлёт live при IH_CLASSIFY_ONLY=1 (дефолт) и без verified-контрактов

## Команды

```bash
# v1-бэкенд должен быть запущен (D:\codexprojects\insta-ebasher: npm run dev / npm start)
node --env-file=state/.env run.mjs mail --v1 http://127.0.0.1:3000 --account <id> --dry-run
node --env-file=state/.env run.mjs mail --v1 http://127.0.0.1:3000 --account <id> --max 10
# env IH_V1_URL альтернатива --v1
# live требует: v1 mode=live_enabled (панель, фраза SEND_REAL_MESSAGES) + IH_CLASSIFY_ONLY=0
```

Аккаунт: `ih accounts add --anty-profile <antyId> --username @x --cap 25` (v2-стор).
v1-аккаунт создаётся скриптом сам (`mailer:<username>`), маппинг в `accounts.v1_account_id`.

## Outcome-маппинг (v2 ошибка → v1)

| v2 код | v1 outcome | v1 реакция |
|---|---|---|
| успех dry | `previewed` | аудит |
| успех live | `sent` (observedHandle) | лид → contacted |
| RecipientResolution | `target_unavailable` | аудит, лид остаётся ready* |
| DmRestricted | `restricted` | аудит |
| SessionError | `login_required` | аудит + heartbeat login_required |
| ConfirmMiss | `uncertain` | лид → unknown (не перевыдастся) |
| CaptchaError (timeout) | `uncertain` | лид → unknown |
| ActionBlock / Proxy / прочее | `failed` | аудит, скрипт стопается |

`*` v1 не выдаёт лид повторно, если по нему был lease (active/expired) — дубль-DM исключён.

## Стоп-условия скрипта

`v1_quota` / `v1_no_campaign` / `v1_natural:No eligible lead` — нормальное окончание кампании.
`fail_closed:*` — action_block/прокси/сессия/капча: стоп аккаунта, cooldown v2 (4/24/72h).
`ih_classify_only` — live запрещён env-гейтом.
`v2_cap:N/25`, `cooldown:*` — лимиты v2-стороны.

## Порядок live-запуска (Phase 3)

1. Anty-профиль под аккаунт рассылки (профиль создаётся на базе owner-VPN; owner логинится в IG руками)
2. `ih selfcheck <profile>` → 7/7
3. Контракт-аудит: `ih mail --dry-run` на живом IG пишет evidence → селекторы verified
4. 3/3 previewed → canary live (1 лид, owner рядом) → `--max 5..10`
5. Панель v1: лиды contacted, quota тикает, audit-лента живая

## Агентский сценарий end-to-end

1. В v1: research job → candidates (как в docs/07 v1) → ревью/апрув до target
2. campaign + template → approve → add-approved-leads → start
3. Запуск рассылки: команда `ih mail ...` (dry-run прогон → проверка отчёта и evidence → live)
4. Мониторинг: v1-панель (SSE) + `state/logs/*.jsonl` + `ih stats`
5. После ответов: inbox-задача агентом (v1 docs/07), phone/opt-out — как в v1
