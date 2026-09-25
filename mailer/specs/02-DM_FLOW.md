# 02 — DM-flow: state-machine + жёсткое подтверждение

## Precheck (до входа в machine, fail-closed)
1. Anty-профиль up, CDP жив, selfcheck ≥ 6/7 (canvas-дритф только алерт)
2. Профиль залогинен: nav содержит ссылку на собственный @ (иначе `SessionError: not logged in`)
3. Proxy gate ok (US/цель, latency)
4. Daily cap не исчерпан (outreach_log: sent сегодня < cap)
5. Lead в статусе `ready` (LLM-классификация = relevant, exact-handle сохранён побуквенно)

## State-machine (один lead)
```
S0 attach (context, page, human-dwell)
S1 goto https://instagram.com/<handle>/          → wait profile render
S2 verify profile: @handle точное совпадение (word-boundary match, как 1.0 handleTextMatches)
   └─ нет exact → RecipientResolutionError, fail-closed, НЕ открывать похожий
S3 profile-dwell 3–8s (человеческое чтение)
S4 button "Message": 3-проходная стратегия (DOM-text → getByRole → first-fallback)
S5 thread open: url содержит /direct/ , composer найден
S6 composer: humanClick → typingPlan → печатаем по символу (Enter≠\n)
S7 send: Enter (или send-button если Enter-недоступен)
S8 CONFIRM (жёсткое post-условие, §3)
S9 exit: linger 0.8–2.2s → goBack на ПРОФИЛЬ (не на home — home за прокси виснет, 1.0)
S10 log outreach_log(sent) + evidence + cooldown
```
Каждый переход = telemetry-событие. Any step fail → typed error + evidence + stop.

## 3. Подтверждение (главный урок 1.0: 194/270 failed на ложных confirms)
Сословие send=success — **только** если выполнено ≥1:
- (a) **DOM**: в открытой тред-ленте появился блок с нашим текстом (exact substring) + статус-иконка (sent/delivered/read) рядом
- (b) **Network**: response `send/{thread|ig_mid}` / graphql `DirectMessaging` с `ok:true` / `is_logged_in` не false
Timeout ожидания confirmation: 15с. Не дождался → `ConfirmMissError` (retriable=false), статус `needs_manual`, evidence скрин.
**Запрещено** считать success «кнопка была нажата» или «composer очистился».

## Action blocks / restrictions (паттерны из 1.0 ACTION_BLOCK_PATTERNS, расширить в audit)
- "You're temporarily blocked", "Please try again later", "No Internet Connection" (в DM-контексте = block), challenge-страница, "Check your connection"
- Обнаружен на любом шаге → `ActionBlockError` → **стоп аккаунта** (cooldown по severity: 4h soft / 24h hard / 72h repeated), НЕ стоп всей кампании.
- `dm_restricted` (получатель ограничил входящие) — `DmRestrictedError`, lead в `dm_restricted`, аккаунт не штрафуется.

## Exit
- После каждого DM: пауза `minDelay..maxDelay` (дефолт 300–420s, как в 1.0), next lead.
- Батч-конец: linger, close context (12h recycle — см. spec 01).

## Failure policy
| Ошибка | Статус lead | Аккаунт |
|---|---|---|
| RecipientResolutionError | failed_exact | ok |
| ConfirmMissError | needs_manual | ok (1 раз retry) |
| DmRestrictedError | dm_restricted | ok |
| ActionBlockError | pending (retry позже) | cooldown 4/24/72h |
| SessionError (×2) | pending | стоп, manual |
| ProxyError | pending | стоп до восстановления прокси |

2 ошибки подряд на разных leads одного аккаунта → `manual_needed` (fail-closed, как ytbot-2).
