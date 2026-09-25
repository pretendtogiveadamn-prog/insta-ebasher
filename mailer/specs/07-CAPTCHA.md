# 07 — Капча и checkpoint (новые/свежие профили)

## Факты
- IG кидает **«Confirm your requests»** (photo-select: выбери все картинки с X) и/или **challenge-страницу** (`/challenges/`) на новых профилях/смене IP/агрессивном старте.
- Тип — photo-select (Google-образная), **не** reCAPTCHA/Turnstile → Turnstile-солверы не применимы.
- Готовых open-source «instagram captcha solver» на GH нет (проверено 2026-09-19).

## Стратегия (порядок)
1. **Prevention** — главный рычаг (см. RESEARCH §8): чистый residential/mobile IP, 1 IP на аккаунт, warmup 3–7 дней (scroll/лайки, без DM), первый вход в видимом окне, не форсить темп в первую неделю.
2. **Детект + manual-solve** (MVP):
   - Детект: URL содержит `/challenges/` ИЛИ в DOM photo-grid (контракт-селектор зоны `captcha`), ИЛИ modal "Confirm your requests".
   - Действие: поднять видимое окно (Anty off-screen → on-screen), TG-алерт, ждать решение owner'ом до `IH_CAPTCHA_TIMEOUT` (дефолт 10 мин).
   - После кликов owner'а — верификация: капча исчезла / URL ушёл с /challenges/ → продолжить.
   - Fail-closed: таймаут → `CaptchaError`, аккаунт в cooldown 24h.
3. **LLM-vision solve** (L2, после MVP): скрин grid'а → vision-модель → координаты → humanClick по ним → верификация приняла. Retry-цикл ≤2, дальше → manual. Лог всех попыток в evidence.
4. **Сервисы (2captcha/CapSolver)** — только если 1–3 не дают результат; проверить поддержку именно IG photo-select перед интеграцией.

## Интеграция в flow
- `CaptchaError` в каталог ошибок (retriable=false, step-метка `captcha`).
- Точки детекта: precheck (после goto, до Message) + mid-flow (на каждом step-check).
- Policy: 1-я капча сессии → manual-solve; 2-я за день с аккаунта → stop + cooldown 24h + TG-алерт.
- Капча = сигнал «профилю плохо» → в `ih stats` отдельная строка; рост частоты капч → пересмотр IP/warmup.

## Тесты
- L1: детект по URL и по mock-DOM (фото-grid), policy-счётчики.
- L3 canary: искусственный challenge (проверка на живом аккаунте после смены IP) → manual-solve путь зелёный.
