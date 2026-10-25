# INSTA-EBASHER

Local CRM and client-controlled Instagram outreach workspace.

## What this package is

The backend owns CRM decisions, recipient eligibility, deduplication and the 35/24h quota. The client selects approved leads, edits the message and runs scripted outreach from the local panel. The sender uses a dedicated, already logged-in Chrome window launched by `mailer/start-chrome.bat`; research can still be run by an agent.

For a research batch, start Codex in this repository and say: `Read prompts/batch-runner.md. Start a research batch; ask me for the target and source if they are missing.` For outreach, open the panel and use **Рассылка**. An agent can operate the same local workflow through `npm run outreach -- help`; CLI and panel share the server's eligibility, preview, quota and sender gates.

Runtime data, Chrome sessions and credentials stay local and are not part of the repository.

## Start here

For a client handoff, start with [`START_FOR_CLIENT_RU.md`](START_FOR_CLIENT_RU.md). The exact agent onboarding runbook is [`prompts/client-onboarding-agent.md`](prompts/client-onboarding-agent.md).

1. Read `AGENTS.md`.
2. Read `docs/01_PRODUCT_SCOPE.md` and `docs/03_AGENT_PROTOCOL.md`.
3. Copy `.env.example` to `.env` only if Telegram alerts are needed; never commit it. Phone normalization is fixed to US `+1` in V1.
4. Run `npm install` in the root and in `mailer/`, then `npm run dev` in the root (or `npm run build && npm start`).
5. Open `http://127.0.0.1:3100/#outreach`; use `mailer/start-chrome.bat` to open the sender's Chrome window and log in. See `START_FOR_CLIENT_RU.md` for the panel flow.

Before an upgrade of an existing local database, run `npm run backup`. Backups contain only SQLite data and a SHA-256 manifest; they never include browser data or secrets.

## Product boundary

V1 completes: research -> delegated or human review -> first Instagram DM -> incoming-reply record -> operator notification.

iMessage, beat packs, sales automation, booking and payments remain data-ready later modules. They do not block V1.

## Delivery rule

Do not ZIP or publish runtime data: `.env`, SQLite, screenshots, exported leads, cookies, tokens or private conversations.
