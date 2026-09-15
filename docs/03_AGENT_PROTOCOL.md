# Agent protocol

## Read order

1. `AGENTS.md`
2. `docs/01_PRODUCT_SCOPE.md`
3. `docs/02_CRM_AND_STATES.md`
4. `docs/04_BACKEND_CONTRACT.md`
5. The task prompt from `prompts/`
6. Runtime memory, only after server state and only if available

## Lease loop

```text
GET state -> POST one lease -> bounded Chrome work -> POST structured result(s) -> complete lease -> refreshed panel
```

The backend lease includes `id`, `expiresAt`, `dryRun` and a server-owned `payload`. Research/inbox leases authorize only their bounded batch; outreach authorizes exactly one target. The agent must match the visible Instagram handle exactly. An expired lease, wrong handle, unavailable Chrome, logged-out session, restriction or ambiguous UI ends the action; report that specific outcome.

## Research task

1. Get a research lease: bounded seed, source types, target count and expiry.
2. Inspect only allowed public/authorised sources.
3. For each discovered account, submit a candidate record immediately with the matching `jobId` and `leaseId`.
4. Candidate `source.seed` and `source.type` must be in the lease payload. The server rejects candidates outside that scope or over the lease target.
5. Stop on lease target, expiry, unavailable Chrome or server rejection, then complete the lease.
5. Report only IDs, counts, duplicates, evidence gaps and review items.

## Outreach task

1. Read server state; stop unless `chrome` is exactly `available`, or if mode is blocked, quota is zero or another lease is active.
2. Request one outreach lease. Never pick a handle or message yourself.
3. For dry-run, navigate and verify only; do not press Send.
4. For a live lease, compare visible recipient and typed message against lease data. A running client-authorized campaign plus the live server gate is the batch authorization; process one lease at a time until the backend returns a stop condition.
5. Submit one outcome. `sent` is a fact only after the backend accepts it.

## Inbox task

Read a bounded inbox lease, identify event facts and submit them. `phone_shared` is only for an explicit US number; raw `4155550100`, `14155550100` and `+14155550100` normalize to `+14155550100`. `opt_out` is treated conservatively; it sets `DO_NOT_CONTACT` server-side. Never draft or send a reply in V1.

## Runtime memory

Runtime memory may record active job IDs, last server-state time, Chrome availability, evidence-quality observations and inbox cursor. It must never hold secrets, private conversations, customer contacts, local quota counts or unsubmitted outcomes.
