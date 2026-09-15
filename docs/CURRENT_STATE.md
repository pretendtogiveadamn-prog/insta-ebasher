# Current state

Verified: 2026-09-14 (после независимого аудита и регрессий, см. `AUDIT_2026-09-14.md`).

- The active deliverable is `D:\codexprojects\insta-ebasher`.
- Local-only Express backend, SQLite CRM, Server-Sent Events panel updates and Telegram notification delivery are implemented.
- There is no browser launcher, proxy, cookie store, persistent browser profile, anti-detect package, Patchright or Playwright dependency.
- Implemented V1: research jobs and candidate evidence, review/DNC, approved lead to campaign, serial batch runner over one-target action leases, 35/24h server quota (с `windowEndsAt`), inbox parsing, phone/email/opt-out state, panel plus Telegram alert attempt.
- Бизнес-правила усилены: брошенный outreach lease переводит `ready`-лид в `unknown` и не выдаётся повторно; inbox записывается транзакционно; DNC терминален; live lease отзывается при выключении отправки; поздний `sent` сохраняет факт без перезаписи более свежего ответа; кандидату обязательны matching `jobId` + research `leaseId` и полные source/evidence; delegated auto-approval требует artist/80+/100+; дневной cap хранится в SQLite и меняется только в диапазоне 1–35.
- Схема: лёгкие миграции (leads.phone_raw, leads.future_json, inbox.lease_id, blocklist) + 7 индексов; snapshot делает SQL-limited выборку лидов и возвращает полные server-side counts.
- Панель: IG-ссылки, полные evidence+source, кнопки по статусам, адресное добавление в кампанию, real-send toggle с фразой-подтверждением, возраст heartbeat, ретрай уведомлений, разблокировка unknown, поиск, капы рендера.
- Сборка: `npm run build` чистит `dist` (свежий билд в `dist/src/`), `npm start` → `dist/src/server.js`; SIGINT/SIGTERM корректно гасят сервис.
- Бекап: `npm run backup` — Онлайн SQLite backup API + integrity-check + manifest (sha256, counts, schemaVersion), WAL-сайдкары в бекап не попадают; проверка бекапа — `verifyBackupManifest(dir)`.
- Research target now counts only delegated-approved qualifying artists; every inspected profile is persisted, and `profileLimit` is server-enforced per lease. Clear non-artists remain durably rejected for dedupe; brief mismatches remain reviewable for later work.
- `npm run check` passes: TypeScript build + 54 теста (регрессии аудитов, backup/panel/границы/рендер, US phone policy, duplicate source history, persisted daily limit and 20 client use cases).
- Телефонные контакты фиксированы на США: явный 10-digit/`1`/`+1` номер нормализуется к `+1XXXXXXXXXX`; другой формат не становится контактом автоматически.
- Независимый верификатор фиксов: `npx tsx scripts/verify-fixes.mts` — пробник 11 сценариев против исходника.
- Chrome MCP must still be attached by the operator. The backend cannot inspect or launch it; a fresh agent heartbeat is required before a DM or inbox lease.
- Telegram works only after the operator creates an untracked `.env` with token and chat ID. Without it alerts persist locally as `not_configured` (ретрай из панели после настройки).
