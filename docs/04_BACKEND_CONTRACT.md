# Backend and panel contract

## Core rule

The backend validates every transition. The panel and agent are API clients; neither may bypass it.

## Agent endpoints

### `GET /api/agent/state`

```json
{
  "mode": "dry_run|live_enabled|blocked",
  "chrome": "required|available|unavailable",
  "stopReason": "heartbeat_stale|login_required|restricted|unavailable|null",
  "rulesVersion": "2026-09-14",
  "quota": {"firstDmRemaining": 35, "windowEndsAt": "ISO-8601 or null"},
  "activeLease": null,
  "activeCampaignId": "uuid or null"
}
```

### Agent outcome rules (enforced)

- Outcome values are whitelisted: `previewed|sent|not_sent|login_required|restricted|target_unavailable|uncertain|failed`.
- `sent` is accepted only when the lease payload has `dryRun=false` and the observed handle matches the lease target exactly. In dry-run the server rejects it with `Sending is disabled in dry-run`.
- Outcomes are accepted for both `active` and `expired` outreach leases, so a slow operator no longer loses the fact. Non-sent outcomes with a mismatched observed handle are recorded as `handle_mismatch` audit instead of being rejected.
- Outreach leases validate the requested account: it must exist, be enabled, and have a fresh (under 90s) `available` heartbeat.

### `POST /api/agent/research-jobs/:jobId/leases`

Input identifies a validated research job. Output contains one bounded batch in `payload`: `seeds`, `sources`, optional genres/locations, `targetCount`, `foundAtGrant` and `profileLimit`. `targetCount` counts only qualifying artist leads approved by the server under this job; `profileLimit` is a server-enforced maximum of inspected profiles recorded with the lease. A candidate is accepted only while its `source.seed` and `source.type` match this payload and neither cap is reached.

```json
{"id":"research-lease-uuid","expiresAt":"ISO-8601","dryRun":true,"payload":{"seeds":["producer"],"sources":["follower"],"targetCount":20,"foundAtGrant":0,"profileLimit":60}}
```

### `POST /api/agent/candidates`

```json
{
  "jobId": "uuid",
  "leaseId": "uuid",
  "handle": "artist_handle",
  "source": {"seed": "producer", "type": "follower", "url": "https://..."},
  "verdict": "artist|uncertain|not_artist",
  "confidence": 0,
  "evidence": [{"kind": "music_link", "url": "https://...", "note": "public release linked in bio"}],
  "genre": null,
  "location": null,
  "followers": null
}
```

`jobId` and an active matching research `leaseId` are required. Use the returned research lease `id` as that `leaseId`. Every source/evidence field is required and non-empty; URLs must be HTTP(S); `followers` is a non-negative integer when supplied. The server normalizes handle, deduplicates globally, blocks candidates outside the leased scope and records an audit event. A duplicate retains its new source/evidence in immutable `duplicate_source` history without creating a second lead.

### `POST /api/agent/research-leads/:id/approve`

For an explicitly delegated brief only. Body must contain the active matching research `jobId` and `leaseId`. The backend accepts autonomous approval solely from `review` to `ready` when verdict is `artist`, confidence is at least 80 and followers are at least 100. It records `agent_auto_approve` against that job; this is what advances the job target. The agent must additionally enforce the client brief, including US fit and music-evidence criteria.

### `POST /api/agent/research-leads/:id/reject`

For a clear `not_artist` only. Moves `review` to `rejected`, records `agent_auto_reject` and preserves the handle/source/evidence for global dedupe. An actual artist that simply misses the current brief must stay in review rather than be globally rejected.

### `POST /api/runtime/daily-limit`

```json
{"limit": 12}
```

Changes the persisted first-DM limit for this local system. Accepted range is 1–35. The agent may call it only after the client explicitly asks to change the current 35-per-rolling-24-hours cap.

### `POST /api/agent/outreach-leases`

Server selects one approved, non-duplicate, non-opted-out lead and renders the campaign message.

```json
{
  "id": "uuid",
  "expiresAt": "ISO-8601",
  "dryRun": true,
  "target": {"leadId": "uuid", "handle": "artist_handle", "message": "server-rendered message"},
  "quota": {"firstDmRemaining": 35, "windowEndsAt": "ISO-8601"}
}
```

### `POST /api/agent/outreach-leases/:id/outcome`

Allowed outcomes: `previewed`, `sent`, `not_sent`, `login_required`, `restricted`, `target_unavailable`, `uncertain`, `failed`.

Accepted `sent` changes a `ready` lead to `IG_CONTACTED`; if a newer inbound state already exists, the backend records the factual send while preserving that newer state. Disabling live mode revokes all still-active live outreach leases before an outcome can be submitted.

### `POST /api/agent/inbox-events`

Input has account, thread/message identifier, exact handle if known, received time and event kind: `new_reply|phone_shared|email_shared|opt_out|other`. The backend deduplicates and emits notifications.

## Panel endpoints

The panel receives server-owned DTOs only: leads/review queue (with `contact` and `future`), campaigns, `leases` history (last 50), audit history, status/quota and inbox events. It can request review approvals, `unblock` (unknown to ready), targeted campaign membership (`POST /api/campaigns/:id/leads {leadIds}`), notification retry (`POST /api/notifications/:id/retry`), runtime gates and task start/stop intent. It cannot calculate eligibility or write arbitrary state.

### `GET /api/panel/snapshot`

One local-only payload for initial load and refresh. The backend derives every counter and label.

```json
{
  "state": {"mode": "dry_run", "chrome": "available", "quota": {"firstDmRemaining": 35}},
  "research": {"leads": [{"id": "uuid", "handle": "artist", "verdict": "uncertain"}]},
  "campaigns": [{"id": "uuid", "name": "September", "status": "approved", "stats": {"ready": 12, "contacted": 3}}],
  "activity": [{"created": "ISO-8601", "kind": "candidate_created", "lead_id": "uuid", "detail": "artist verdict"}],
  "inbox": [{"handle": "artist", "kind": "new_reply", "received": "ISO-8601"}]
}
```

The panel refreshes this snapshot after an operator request or accepted agent outcome. It never derives a quota, status, approval or send result locally.

### Client outreach API and CLI

The local `npm run outreach -- ...` CLI uses the same `/api/operator/*` routes as the panel. `GET /api/operator/leads?state=ready&query=&offset=0&limit=100` searches the entire CRM with server-side pagination. `POST /api/operator/plans` accepts `{name,body,allReady,leadIds,excludedIds}`; the server resolves all eligible recipients in one transaction. `PATCH /api/operator/plans/:id/message` replaces the template and invalidates its previous preview.

`GET /api/operator/mailer` lists local Chrome sender accounts. `POST /api/operator/mailer/accounts` adds and activates a local sender; `POST /api/operator/mailer/accounts/:id/activate` switches to one. Account changes return live mode to dry-run and invalidate previous previews. The panel sends the v2 sender ID to `/api/operator/mailer/start`; the server resolves its stored V1 account ID before checking preview evidence. The preview must match the current campaign template and selected sender, and be newer than the latest sender change. The worker still receives the v2 sender ID for its own database.

## Required backend validation

- lease ownership, expiry and one-outcome idempotency;
- exact handle match and unique initial contact;
- campaign approval, `DO_NOT_CONTACT`, account pause and quota;
- schema validation, research lease scope, evidence URL validation and content size limits;
- no secrets in responses/logs; screenshot references remain local and access-controlled.
