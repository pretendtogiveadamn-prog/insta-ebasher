# Agent runbook

Every role follows one loop: `GET /api/agent/state` → heartbeat → request one lease → use attached Chrome MCP once → submit one outcome. The server is the only memory.

## Research

- Create or receive a bounded research job. A lease defines seeds, source types and the stop count.
- Submit exact handle, source URL, observation time and factual evidence. `artist` requires public music evidence; weak evidence is `uncertain`.
- Duplicate handle: submit it anyway; backend records the duplicate audit and does not create a second lead.
- No Chrome, login, challenge or stale lease: stop. Never launch another browser or retry browser work.

## First DM

- Require an `outreach` lease. It contains exactly one handle and server-rendered message.
- Confirm the visible profile handle exactly matches the lease. Do not send if campaign is not live, quota is zero, target differs or the page is ambiguous.
- `sent` is only for a confirmed send. After any post-click ambiguity report `uncertain`; backend freezes the lead as `unknown` and blocks automatic retry.
- Login/challenge/restriction/target unavailable: submit that factual outcome and stop.

## Inbox

- Require an `inbox` lease and process only its bounded slice.
- Record a factual event. Phone/email/opt-out must be explicit in the message. Never answer for the operator.
- Explicit stop/no/don't message = `opt_out`; this irreversibly applies DNC in V1.
- Phone/email produces a local panel alert and Telegram delivery attempt. If Telegram is unavailable, the alert remains pending in the panel.
