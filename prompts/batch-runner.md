# Batch runner

Read `AGENTS.md`, `docs/03_AGENT_PROTOCOL.md`, `docs/05_ARTIST_RESEARCH.md`, `docs/07_AGENT_RUNBOOK.md` and `docs/09_CHROME_MCP_PLAYBOOK.md` before work. Use only the attached Chrome MCP session and backend API. Work serially; never open parallel browser actions.

## Research batch

Use this when the operator asks to find artists.

1. Ask one short brief question before doing anything: `Кого ищем, сколько артистов нужно, у каких продюсеров искать и какие критерии важны?` Do not choose a target or source yourself. The defaults are US, at least 100 followers, and sources `follower`, `following`, `tagged`; do not use comments unless the client explicitly asks. Then turn the answer into one bounded job: target, producer seed(s), allowed source(s), and a target count. If the client explicitly asks for Instagram Search, use source type `search`. Default to 20 candidates unless the client gave another number.
2. Create the job, obtain one research lease and process profiles serially. `payload.targetCount` is the number of qualifying artists to auto-approve; `payload.profileLimit` is the hard number of profiles that may be recorded under this lease. Respect both.
3. Remember every inspected profile by submitting a candidate record. A strong candidate has own music posts plus either a public music link (YouTube, Spotify, SoundCloud, Linktree/music link) or a clear music bio. Capture the exact visible evidence. A clear non-artist uses verdict `not_artist`; an artist that misses the current brief or lacks proof uses `uncertain` and remains in review for a later brief.
4. The client has delegated approval for the default brief. Auto-approve only strong candidates that meet the client criteria, are US-fit, have 100+ followers, verdict `artist` and confidence 80+. Call `POST /api/agent/research-leads/:id/approve` with the current `jobId` and `leaseId`. For a clear non-artist, call `POST /api/agent/research-leads/:id/reject`; this preserves the record and prevents repeat research. Leave every uncertain or current-brief mismatch in review.
5. When the server marks the job `completed`, stop research. If the profile limit is reached first, complete the lease, stop the job and report that the source was exhausted before the target.
6. Return only the concise result: found, auto-approved, uncertain, skipped and duplicates. Tell the client that the 35-first-DM-per-24-hours cap applies before outreach.

## Outreach batch

Use this only after the client supplied the exact message text and explicitly said to launch. The agent creates the template, approves it, creates the campaign, adds ready leads, approves and starts the campaign, then enables real sending with `SEND_REAL_MESSAGES`. The campaign start plus the live gate is the one approval for this batch. Never draft, rewrite or alter the client message.

1. Read state and the panel snapshot. Use the one enabled account that matches the attached Chrome session; heartbeat it before requesting work.
2. Request one outreach lease. If the server issues none, stop and report the reason: quota reached, no approved lead, paused campaign, Chrome unavailable or active lease.
3. Follow the First DM steps in `09_CHROME_MCP_PLAYBOOK.md`: verify handle exactly, use the server message exactly, click Send once, submit the factual outcome.
4. Only after a confirmed `sent`, request the next lease. Continue serially until the server quota or eligible leads end.
5. On login/challenge/restriction, handle mismatch, missing Direct control, post-click ambiguity, API failure or expired browser action: submit the factual outcome once and stop the batch. Never retry a DM. Tell the client the current server limit is 35 first DMs per rolling 24 hours; change it only when the client explicitly requests a new limit from 1 to 35, via `POST /api/runtime/daily-limit`.

## Inbox batch

1. Obtain one inbox lease for the active account and process its bounded slice sequentially.
2. Record factual events only; never reply. Complete the lease and report the number of replies, US phones, emails and opt-outs.
