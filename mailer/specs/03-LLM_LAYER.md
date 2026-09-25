# 03 — LLM-слой (ресерч → классификация → генерация)

## Граница
LLM работает **до** DM-flow и не входит в него. Выход LLM-слоя = готовый lead: `{handle, relevance, tone, personalHook, draft}`. Механика берёт draft и шлёт.

## Конвейер
1. **research.mjs** — собирает факты о лиде (источники см. spec 00 «Качество двух фич»):
   - ArtistConnect (наши биты, Firestore runQuery через залогиненный профиль — логика `beat-recovery/src/harvester/artistconnect/`)
   - страница профиля IG через browser (bio, followers, последние посты)
   - веб-ресерч (опц., depth)
   - Результат — структурированный fact-block (JSON), **кэшируется** в `llm_cache` по (handle, sourceHash, 30 дней).
2. **classify.mjs** — по fact-block решает:
   - `relevance: 0..1` (использует type beat нашего каталога?)
   - `category`: artist / producer / label / fanpage / unknown
   - `active`: есть свежие посты/сторис (30 дней)?
   - `dm_worth: yes / no` + причина
   - Verdict `no` → lead в `rejected`, DM не шлём.
3. **compose.mjs** — генерация DM-текста:
   - вход: personalHook (конкретный трек/факт из research), tone (из classify), каталог наших битов (название/настроение), наш @ и ссылка.
   - ограничения: 1–3 предложения, без «Добрый день, меня зовут...», персонализация ОБЯЗАТЕЛЬНА (конкретный трек/название), без {{...}}-артефактов после подстановки.
   - выход: `draft` (1 вариант). A/B-варианты — позже, не в MVP.

## Правила вызова
- Модель: OpenRouter (конфиг `IH_LLM_MODEL`, дефолт — быстрый дешёвый, напр. deepseek-класс; quality-проверки — через `IH_LLM_MODEL_QA`).
- Бюджет: ≤1 LLM-вызов на lead (research+classify+compose можно слить в 1 structured call; раздельно — только при retry).
- Температура: classify 0, compose 0.7.
- Fail-closed: `LlmError` → lead в `llm_failed` (retry при следующем цикле), **DM не шлём без вердикта**.
- ДRY_RUN-аналог: `IH_CLASSIFY_ONLY=1` — собираем и классифицируем, не шлём (проверка качества вердиктов до live).

## Качество (как мерить)
- Ручная оценка 20 случайных verdict'ов: precision `dm_worth=yes` ≥ 0.8 — gate Phase 3.
- Отслеживаем reply-rate (ответ пришёл в течение 7 дней) — телеметрия `outreach_log.replied`.

## Кэш
`llm_cache(key=sha256(handle|facts|promptVersion))` → {verdict, draft, model, ts}. Повторный lead (тот же handle, факт-снимок не изменился) — 0 вызовов.
