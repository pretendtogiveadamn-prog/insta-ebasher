# Batch use cases

These are the required V1 paths for a client-operated agent. Each one has an explicit stop or next action; none relies on private agent memory.

| # | Client or Instagram situation | Required system behaviour | Coverage |
|---|---|---|---|
| 1 | Client says only “find artists” | Agent asks one brief question for target, count, producer accounts and extra criteria before creating work. | `prompts/batch-runner.md` |
| 2 | Client gives producer accounts | Agent searches only followers, following and tagged profiles by default; comments require explicit client instruction. | `prompts/batch-runner.md`, `docs/05_ARTIST_RESEARCH.md` |
| 3 | Profile is a strong match | Agent stores source/evidence, then auto-approves only if artist, 80+ confidence, 100+ followers, US fit and agreed music proof. | `Store.autoApprove`, `/api/agent/research-leads/:id/approve` |
| 4 | Profile is clearly not an artist | Agent stores it, auto-rejects it and keeps the handle/source/evidence for dedupe. | `Store.autoReject`, `/api/agent/research-leads/:id/reject` |
| 5 | Artist exists but misses current brief or proof is weak | Agent stores it as `uncertain`/review; it receives no DM but remains available for a future brief. | `docs/05_ARTIST_RESEARCH.md`, `prompts/batch-runner.md` |
| 6 | Same handle is found from another producer | No second lead is created. The new source/evidence is appended as immutable `duplicate_source` audit history. | `Store.lead`, `tests/audit-polish.test.ts` |
| 7 | Research source is exhausted | Server limits both qualifying artists and recorded inspected profiles. Agent completes/stops the job and reports partial results; it never crawls forever. | `Store.researchInspections`, candidate route, `profileLimit` lease payload |
| 8 | Research target is reached | Server marks the job `completed` only after the requested number of qualifying artists is auto-approved; agent stops the batch. | delegated approval route in `src/server.ts` |
| 9 | Client says “launch” and supplies exact DM text | Agent creates/starts the campaign, enables live mode, sends serially up to the persisted 1–35 rolling-24-hour cap, then stops when no lease is issued. | `prompts/batch-runner.md`, lease/quota backend |
| 10 | Chrome issue, wrong profile, challenge, unknown post-click result, reply or opt-out | Agent records one factual outcome, stops unsafe browser work, never retries the DM; inbox saves reply/contact/opt-out and alerts panel/Telegram. | `AGENTS.md`, `docs/09_CHROME_MCP_PLAYBOOK.md`, inbox/outreach store rules |
| 11 | Client asks for a different daily cap | System persists the explicit 1–35 limit; values above 35 are rejected. | `Store.setDailyLimit`, `tests/user-stories.test.ts` |
| 12 | Client pauses the Instagram account | No outreach lease is issued for the paused account. | `Store.outreach`, `tests/user-stories.test.ts` |
| 13 | Client pauses the campaign | No new first-DM lease is issued until the campaign is started again. | `Store.campaignState`, `tests/user-stories.test.ts` |
| 14 | Chrome heartbeat is stale | Agent receives no outreach work and must reconnect/check Chrome first. | `Store.outreach`, `tests/user-stories.test.ts` |
| 15 | Client supplied exact DM wording | Server renders only the recipient handle; the rest of the text is preserved verbatim. | template rendering, `tests/user-stories.test.ts` |
| 16 | Agent/browser action is abandoned or expires | Lead becomes `unknown` and is not leased again automatically; only the operator may unblock it. | `recoverExpiredOutreachLeases`, `tests/user-stories.test.ts` |
| 17 | Client disables live sending during a batch | Any already-issued live lease is revoked; a later `sent` result is rejected. | `revokeLiveOutreachLeases`, `tests/user-stories.test.ts` |
| 18 | Agent scans the same inbound message twice | One inbox event and one notification are kept; the second submission is an idempotent duplicate. | `inboxEvent`, `tests/user-stories.test.ts` |
| 19 | Unknown person says “stop” | Handle enters the blocklist immediately; future research creates it directly as DNC. | blocklist flow, `tests/user-stories.test.ts` |
| 20 | Telegram is temporarily unavailable | Alert remains in the local panel with `pending` status and can be retried; no contact fact is lost. | notifications + retry endpoint, `tests/user-stories.test.ts` |

## Batch boundaries

- Research is serial and bounded: at most the lease `profileLimit` profiles, normally up to 60.
- Outreach is serial and bounded by the server quota and ready leads; it is never a parallel bulk sender.
- Inbox is separate: the client asks for an inbox batch when wanted; V1 has no background monitor.
- The client can change the persisted first-DM cap from 1 to 35 only by explicitly asking the agent.
