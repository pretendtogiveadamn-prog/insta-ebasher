# TRAPS — ошибки 1.0 (beat-recovery sender), перенесённые в insta-ebasher-v2

Источники: `D:\codexprojects\beat-recovery\docs\TRAPS.md` (#51, #53, #60, #75-#86), INSTAGRAM_OUTREACH.md, аудит 2026-08-03.

1. **Enter в composer = SEND.** Перенос строки — только `Shift+Enter`. (1.0: фрагментация сообщения на абзацы)
2. **Composer — не textarea.** Контент через contenteditable; печать настоящими keydown-событиями, не `insertText`/paste (телл детектора).
3. **`no-result-rendered` — главный дефект 1.0** (194/270 failed): ждали результат, который не отрендерился. Здесь: жёсткое CONFIRM (spec 02 §3) — DOM-текст в ленте ИЛИ network ok. Иначе `ConfirmMissError` + manual, не «success».
4. **Ложные post-click confirmations** — «нажал» ≠ «ушло». Строгое post-условие, timeout 15с.
5. **Wrong/unverifiable recipient** — fallback-стратегии кликали на decoy-элементы. Правило: exact-handle word-boundary match (handleTextMatches), иначе `RecipientResolutionError`, fail-closed. Никогда не «похожий аккаунт».
6. **Exit — по-человечески на главную (owner 2026-09-25):** после CONFIRM linger → SPA-клик по Home-иконке (НЕ полный goto — home за резидентным прокси виснет ~30с, 1.0) → dwell 12–25с со скроллом («в кд»). Best-effort: сбой exit не фейлит уже подтверждённую отправку.
7. **Сессия >12ч — recycle.** Долгоживущий контекст копит state; периодический close+open.
8. **Прокси fail-closed:** нет резолва прокси → Chrome не запускается (1.0 TRAPS #79: аккаунт тихо шёл с реального IP сервера). 1 аккаунт = 1 IP.
9. **Ротация IP mid-action → suspicious login checkpoint** (ресерч 2026 + 1.0).
10. **`--disable-blink-features=AutomationControlled` и кастом-UA — сами по себе теллы.** Patchright best-practice: не ставить (в 1.0 уже так; Anty-панель ставит свой набор — сверить при аудите, не дублировать).
11. **Headless-режим = headed-окно за экраном** (UA `HeadlessChrome` палится) + анти-throttle флаги.
12. **Аудит 1.0: dm_restricted (26/270)** — получатель ограничил входящие. Не штрафовать аккаунт, lead → `dm_restricted`.
13. **login_required (1/270)** — сессия протухла. Проверять @ в nav перед батчем (precheck spec 02).
14. **Форумные цифры лимитов — нижняя граница выживших.** Калибровать своим outreach_log.

## 9. innerText теряет эмодзи в пузырях (IG рендерит их как <img>) — 2026-09-25
confirmSent давал ConfirmMissError на РЕАЛЬНО отправленном сообщении: в пузыре эмодзи — `<img>`,
и `innerText`/`textContent` его не содержат. Плюс переносы строк в пузыре → `\n`.
Правило: сравнение текстов для подтверждения — по буквенно-цифровому скелету
(`[^\p{L}\p{N}]+ → " "`, lower). См. verify.mjs skel() + evidence dm-6b516d6b-1790333859427.

## 10. keyboard.press(char) падает на эмодзи — 2026-09-25
`press("👋")` → Unknown key. Per-char печать — только `keyboard.type(char)` (ascii → keydown/up,
эмодзи → per-char fallback). См. human.mjs typeText.

## 11. Stale box после скролла: координатный клик мимо — 2026-09-25
S3-dwell скроллит профиль → Message-кнопка уходит за вьюпорт → клик по старому box попадает в пустоту.
Правило: перед кликом scrollTo(0,0) + СВЕЖИЙ резолв кандидатов; humanClick делает
offscreen-recovery (scrollIntoView + свежий boundingBox). Recovery через locator по классам
ненадёжен (классы IG повторяются) — свежий deepQuery лучше.
