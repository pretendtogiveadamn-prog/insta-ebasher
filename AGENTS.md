# INSTA-EBASHER agent rules

## System model

- Backend is the only source of truth for leads, campaign state, quotas, delegated approval, dedupe, opt-outs and delivery outcomes.
- Codex is a controlled browser operator through attached Google Chrome MCP.
- The panel only renders API state and submits operator intent. It does not decide eligibility, quotas, state transitions, score, dedupe or send permission.

## Mandatory loop

Before each leased batch, fetch current server state and request one current lease. A research or inbox lease permits only its bounded batch; an outreach lease permits exactly one target. Submit every candidate/event immediately, then complete the lease. Submit exactly one outreach outcome. If a server call fails, the lease expires, or the UI is ambiguous, stop browser work. If an outreach action already occurred, still submit its factual outcome once; never repeat an external action blindly.

## Browser rules

- Use only the already-open Chrome session explicitly attached to Codex by the operator.
- Do not launch a browser, import cookies, configure a proxy, use Playwright/Patchright, use headless mode, modify fingerprints, imitate mouse movement or fake typing cadence.
- Do not login, follow, like, comment, reply or send a DM without a server lease. Before a real send, require a client-authorized running campaign and the server's live gate.
- A running, client-authorized campaign plus the server live gate is the one batch confirmation. With both active, process outreach leases serially until the server says to stop. The operator can stop immediately by pausing the campaign or disabling real sending; do not require a confirmation before every DM.

## Research rules

- Evidence, not appearance, decides whether an account is an artist. Follow `docs/05_ARTIST_RESEARCH.md`.
- Never infer race, ethnicity, protected traits, wealth or buyer intent from appearance.
- Exact handle, source URL and factual evidence are mandatory. `source.seed` and `source.type` must be from the research lease. Weak evidence is `uncertain`, never a reason to contact.
- Do not do unbounded follower/following crawls. Record every inspected profile, stop at the server-enforced `profileLimit`, and stop when the requested number of qualifying artists has been approved.
- The operator may delegate approval in the written brief. Auto-approve only a `review` lead with verdict `artist`, confidence at least 80, at least 100 followers, US fit and the exact agreed evidence criteria; otherwise leave it in review.

## Data rules

- Never write SQLite directly or retain a private tally of sends. The server returns authoritative quota on every lease.
- Never fabricate releases, music links, artist relations, location, genre, messages or outcomes.
- All phone contacts are US only. For `phone_shared`, submit the exact raw number only when it is an explicit US 10-digit number, `1` plus 10 digits, or `+1` plus 10 digits. The backend stores the raw value and normalizes it to `+1XXXXXXXXXX`; never invent a country code.
- Never expose cookies, tokens, message text, phone/email, screenshots or runtime memory in a public response.
