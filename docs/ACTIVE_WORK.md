# Active work

| Owner | Scope | Status | Validation | Next |
|---|---|---|---|---|
| Pi + Codex | Аудит + фиксы бизнес-логики/UX (см. `08_AUDIT.md`, `AUDIT_2026-09-14.md`) | completed locally | `npm run check` (54/54); `npx tsx scripts/verify-fixes.mts` (11 сценариев) | Attach Chrome MCP and run the operator's own-account dry run |
| Codex | Клиентское управление рассылкой из панели: `src/server.ts`, `src/store.ts`, `src/mailer-control.ts`, `public/**`, `mailer/src/orch/mailer.mjs`, tests, docs | implemented locally | `npm run check` 62/62, `mailer/npm test` 150/150, browser 1440/390 px | Owner-controlled dry-run on the actual logged-in Chrome account, then live canary |
| Codex | Независимый сценарный и визуальный QA панели, API и ограничений рассылки; `docs/FEATURES.md`, исправления по итогам | completed locally | Root 62/62, mailer 150/150; browser desktop/mobile and isolated account API/CLI; `docs/FEATURES.md` | Owner-controlled dry-run on actual logged-in Chrome account, then live canary |
