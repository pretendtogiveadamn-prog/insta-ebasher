# Active work

| Owner | Scope | Status | Validation | Next |
|---|---|---|---|---|
| Pi + Codex | Аудит + фиксы бизнес-логики/UX (см. `08_AUDIT.md`, `AUDIT_2026-09-14.md`) | completed locally | `npm run check` (54/54); `npx tsx scripts/verify-fixes.mts` (11 сценариев) | Attach Chrome MCP and run the operator's own-account dry run |
| Codex | Клиентское управление рассылкой из панели: `src/server.ts`, `src/store.ts`, `src/mailer-control.ts`, `public/**`, `mailer/src/orch/mailer.mjs`, tests, docs | implemented locally | `npm run check` 59/59, `mailer/npm test` 150/150, browser 1440/390 px | Owner-controlled dry-run on the actual logged-in Chrome account, then live canary |
