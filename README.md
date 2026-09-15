# INSTA-EBASHER

Portable specification package for a Codex-operated Instagram research and outreach workspace.

## What this package is

The agent operates the operator's already-open Google Chrome through Codex Chrome MCP. The backend owns every business decision and all CRM state. The operator panel is a thin view of the backend.

For a leave-running batch, start Codex in this repository and say: `Read prompts/batch-runner.md. Start a research batch; ask me for the target and source if they are missing.` After review and campaign approval, say: `Run the outreach batch from prompts/batch-runner.md.`

This repository deliberately contains **no** browser launcher, proxy, cookie, persistent Chrome profile, stealth/anti-detect package, frontend business logic or client data.

## Start here

1. Read `AGENTS.md`.
2. Read `docs/01_PRODUCT_SCOPE.md` and `docs/03_AGENT_PROTOCOL.md`.
3. Copy `.env.example` to `.env` only if Telegram alerts are needed; never commit it. Phone normalization is fixed to US `+1` in V1.
4. Run `npm install` and `npm run dev` (или `npm run build && npm start` — start запускает `dist/src/server.js`).
5. Read `docs/07_AGENT_RUNBOOK.md`, then give Codex the matching prompt in `prompts/`.

Before an upgrade of an existing local database, run `npm run backup`. Backups contain only SQLite data and a SHA-256 manifest; they never include browser data or secrets.

## Product boundary

V1 completes: research -> delegated or human review -> first Instagram DM -> incoming-reply record -> operator notification.

iMessage, beat packs, sales automation, booking and payments remain data-ready later modules. They do not block V1.

## Delivery rule

Do not ZIP or publish runtime data: `.env`, SQLite, screenshots, exported leads, cookies, tokens or private conversations.
