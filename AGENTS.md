# INSTA-EBASHER agent rules

## System model

- Backend is the only source of truth for leads, campaign state, quotas, review, dedupe, opt-outs and delivery outcomes.
- Codex is a controlled browser operator through attached Google Chrome MCP.
- The panel only renders API state and submits operator intent. It does not decide eligibility, quotas, state transitions, score, dedupe or send permission.

## Mandatory loop

Before each browser action: fetch current server state and request a current lease. After it: submit exactly one structured outcome using that lease ID. If either server call fails, stop. Never repeat an external action blindly.

## Browser rules

- Use only the already-open Chrome session explicitly attached to Codex by the operator.
- Do not launch a browser, import cookies, configure a proxy, use Playwright/Patchright, use headless mode, modify fingerprints, imitate mouse movement or fake typing cadence.
- Do not login, follow, like, comment, reply or send a DM without a server lease. Before a real send, require the server's live gate and a final operator confirmation.

## Research rules

- Evidence, not appearance, decides whether an account is an artist. Follow `docs/05_ARTIST_RESEARCH.md`.
- Never infer race, ethnicity, protected traits, wealth or buyer intent from appearance.
- Exact handle, source URL, factual observation and observation time are mandatory. Weak evidence is `uncertain`, never a reason to contact.
- Do not do unbounded follower/following crawls. Stop at the current lease target and allowed sources.

## Data rules

- Never write SQLite directly or retain a private tally of sends. The server returns authoritative quota on every lease.
- Never fabricate releases, music links, artist relations, location, genre, messages or outcomes.
- Never expose cookies, tokens, message text, phone/email, screenshots or runtime memory in a public response.
