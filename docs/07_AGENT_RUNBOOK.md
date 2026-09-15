# Agent runbook

Every role follows one loop: `GET /api/agent/state` → fresh heartbeat when Chrome state changed → request one lease → bounded attached-Chrome work → submit structured result(s) → complete the lease. Outreach has one target and one outcome; research/inbox have bounded batches. The server is the only memory.

## Research

- First ask the client: who to find, how many, which producer accounts to use and any extra criteria. Defaults are US, 100+ followers and `follower`/`following`/`tagged` sources. A lease defines seeds, source types, the qualifying-artist target and a server-enforced `profileLimit`; stop when either limit is reached.
- Submit exact handle, source URL and factual evidence. `source.seed` and `source.type` must exactly match the current research lease. `artist` requires public music evidence; weak evidence is `uncertain`.
- The client may delegate approval. For the default brief, auto-approve only US-fit `artist` leads with confidence 80+, 100+ followers, own music posts and either a public music link or clear music bio. Leave anything else in review.
- Record every inspected profile. Auto-reject only a clear `not_artist`; this persists the rejected record for dedupe. A real artist that misses the current brief is not a global rejection: keep it in review for a possible later brief.
- Duplicate handle: submit it anyway; backend records the new source/evidence in immutable duplicate history and does not create a second lead.
- No Chrome, login, challenge or stale lease: stop. Never launch another browser or retry browser work.

## First DM

- Require an `outreach` lease. It contains exactly one handle and server-rendered message.
- Confirm the visible profile handle exactly matches the lease. Do not send if campaign is not live, quota is zero, target differs or the page is ambiguous.
- The client provides the exact DM text. `sent` is only for a confirmed send **in live mode** — in dry-run the server rejects a `sent` outcome, so verify and report `previewed` instead. A started campaign plus enabled real-send mode is the operator's batch authorization; process one lease at a time until the server stops issuing them. The default cap is 35 first DMs per rolling 24 hours; change it only on the client's explicit request, within 1–35. After any post-click ambiguity report `uncertain`; backend freezes the lead as `unknown` and blocks automatic retry (the operator can unblock it from the panel).
- If the lease has expired, still submit the factual outcome — the server accepts outcomes for expired outreach leases so the fact is never lost.
- If the visible handle differs from the lease, report any non-sent outcome (e.g. `target_unavailable`); the server records the mismatch instead of rejecting the report.
- Login/challenge/restriction/target unavailable: submit that factual outcome and stop.

## Inbox

- Require an `inbox` lease and process only its bounded slice. Phone contacts are US-only: submit an explicit 10-digit US number (with or without `+1`) as `phone_shared`; the backend normalizes it to `+1XXXXXXXXXX`.
- Record a factual event. Phone/email/opt-out must be explicit in the message. Never answer for the operator.
- Explicit stop/no/don't message = `opt_out`; this irreversibly applies DNC in V1. An opt-out from a handle outside the CRM is recorded in the backend blocklist and alerts the operator.
- Phone/email produces a local panel alert and Telegram delivery attempt. Every new inbound reply also alerts the operator. If Telegram is unavailable, the alert remains in the panel and can be retried from there.
