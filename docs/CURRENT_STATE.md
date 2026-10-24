# Current state

Verified: 2026-10-24. Previous V1 audit: `AUDIT_2026-09-14.md`.

## Client outreach panel (2026-10-24)

- Active checkout: `D:\codexprojects\insta-ebasher`. Client flow is local `http://127.0.0.1:3100/#outreach`.
- The client can select all `ready` leads from the full CRM, exclude individual leads, write and revise a campaign message, select a local Chrome sender account, run a one-recipient dry-run, enable and start live scripted sending, inspect progress, and stop further recipients.
- Script worker is `mailer/` via the V1 lease API. Research still uses the agent workflow. V1 decides recipient, message rendering, DNC, quota and deduplication. Only one local worker runs at a time; live enable resets when it exits. Changing message or account invalidates the preview gate.
- Client sender browser is a dedicated Chrome window launched by `mailer/start-chrome.bat` and visible at CDP port 9222. The panel checks CDP readiness but cannot independently prove which Instagram account is logged in; the client must check it matches the selected @username before live sending.
- Server shutdown during an active batch pauses the campaign and waits for the worker to finish its current action and record the outcome. Unknown send outcomes remain `unknown` for review.
- Validation: root `npm run check` (59/59), `mailer/npm test` (150/150), `node --check` UI scripts, headless browser smoke at 1440px and 390px with no JS errors or overflow. No real DM was sent in validation. Live account/browser behavior still needs an owner-controlled dry-run on the actual Chrome session.

## V1 baseline (2026-09-14)

- The active deliverable is `D:\codexprojects\insta-ebasher`.
- Local-only Express backend, SQLite CRM, Server-Sent Events panel updates and Telegram notification delivery are implemented.
- V1 research still has no browser launcher or persistent browser dependency. Client outreach now uses the separate `mailer/` Chrome script.
- Implemented V1: research jobs and candidate evidence, review/DNC, approved lead to campaign, serial batch runner over one-target action leases, 35/24h server quota (с `windowEndsAt`), inbox parsing, phone/email/opt-out state, panel plus Telegram alert attempt.
- Бизнес-правила усилены: брошенный outreach lease переводит `ready`-лид в `unknown` и не выдаётся повторно; inbox записывается транзакционно; DNC терминален; live lease отзывается при выключении отправки; поздний `sent` сохраняет факт без перезаписи более свежего ответа; кандидату обязательны matching `jobId` + research `leaseId` и полные source/evidence; delegated auto-approval требует artist/80+/100+; дневной cap хранится в SQLite и меняется только в диапазоне 1–35.
- Схема: лёгкие миграции (leads.phone_raw, leads.future_json, inbox.lease_id, blocklist) + 7 индексов; snapshot делает SQL-limited выборку лидов и возвращает полные server-side counts.
- Панель: IG-ссылки, полные evidence+source, кнопки по статусам, адресное добавление в кампанию, real-send toggle с фразой-подтверждением, возраст heartbeat, ретрай уведомлений, разблокировка unknown, поиск, капы рендера.
- Сборка: `npm run build` чистит `dist` (свежий билд в `dist/src/`), `npm start` → `dist/src/server.js`.
- Бекап: `npm run backup` — Онлайн SQLite backup API + integrity-check + manifest (sha256, counts, schemaVersion), WAL-сайдкары в бекап не попадают; проверка бекапа — `verifyBackupManifest(dir)`.
- Research target now counts only delegated-approved qualifying artists; every inspected profile is persisted, and `profileLimit` is server-enforced per lease. Clear non-artists remain durably rejected for dedupe; brief mismatches remain reviewable for later work.
- At the V1 audit, `npm run check` passed 54 tests. The current count is 59 (see above).
- Телефонные контакты фиксированы на США: явный 10-digit/`1`/`+1` номер нормализуется к `+1XXXXXXXXXX`; другой формат не становится контактом автоматически.
- Независимый верификатор фиксов: `npx tsx scripts/verify-fixes.mts` — пробник 11 сценариев против исходника.
- For agent-driven research and inbox work, Chrome MCP attachment and fresh heartbeat remain required. The client outreach worker supplies its own heartbeat through the V1 API.
- Telegram works only after the operator creates an untracked `.env` with token and chat ID. Without it alerts persist locally as `not_configured` (ретрай из панели после настройки).
