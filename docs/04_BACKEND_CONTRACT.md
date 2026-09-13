# Backend and panel contract

## Core rule

The backend validates every transition. The panel and agent are API clients; neither may bypass it.

## Agent endpoints

### `GET /api/agent/state`

```json
{
  "mode": "dry_run|live_enabled|blocked",
  "chrome": "required|available|unavailable",
  "quota": {"firstDmRemaining": 35, "windowEndsAt": "ISO-8601"},
  "activeLease": null,
  "rulesVersion": "v1",
  "stopReason": null
}
```

### `POST /api/agent/research-leases`

Input identifies a validated research job. Output contains one bounded seed/source slice, allowed source types, target count and expiry.

### `POST /api/agent/candidates`

```json
{
  "leaseId": "uuid",
  "handle": "artist_handle",
  "source": {"seedHandle": "producer", "type": "follower", "url": "https://..."},
  "artistVerdict": "artist|uncertain|not_artist",
  "confidence": 0,
  "evidence": [{"kind": "music_link", "url": "https://...", "note": "public release linked in bio"}],
  "observed": {"genre": null, "location": null, "followers": null, "lastActivityAt": null},
  "observedAt": "ISO-8601"
}
```

Server normalizes handle, deduplicates globally, blocks disallowed status transitions and records an audit event.

### `POST /api/agent/outreach-leases`

Server selects one approved, non-duplicate, non-opted-out lead and renders the campaign message.

```json
{
  "leaseId": "uuid",
  "action": "preview_dm|send_first_dm",
  "expiresAt": "ISO-8601",
  "dryRun": true,
  "target": {"leadId": "uuid", "handle": "artist_handle", "message": "server-rendered message"},
  "quota": {"firstDmRemaining": 35, "windowEndsAt": "ISO-8601"}
}
```

### `POST /api/agent/outreach-leases/:leaseId/outcome`

Allowed outcomes: `previewed`, `sent`, `not_sent`, `login_required`, `restricted`, `target_unavailable`, `uncertain`, `failed`.

Server accepts one idempotent outcome per lease. Only accepted `sent` changes a lead to `IG_CONTACTED` and decrements quota atomically.

### `POST /api/agent/inbox-events`

Input has account, thread/message identifier, exact handle if known, received time and event kind: `new_reply|phone_shared|email_shared|opt_out|other`. The backend deduplicates and emits notifications.

## Panel endpoints

The panel receives server-owned DTOs only: leads/review queue, campaigns, lease/audit history, status/quota and inbox events. It can request review approvals, campaign drafts/approval, runtime gates and task start/stop intent. It cannot calculate eligibility or write arbitrary state.

### `GET /api/panel/snapshot`

One authenticated payload for initial load and refresh. The backend derives every counter and label.

```json
{
  "system": {"mode": "dry_run", "chrome": "available", "firstDmRemaining": 35},
  "review": [{"leadId": "uuid", "handle": "artist", "verdict": "uncertain", "evidenceCount": 1, "source": "producer"}],
  "campaigns": [{"id": "uuid", "name": "September", "status": "approved", "stats": {"ready": 12, "contacted": 3}}],
  "activity": [{"at": "ISO-8601", "kind": "candidate_created", "leadId": "uuid", "detail": "artist verdict"}],
  "inbox": [{"leadId": "uuid", "handle": "artist", "kind": "new_reply", "receivedAt": "ISO-8601"}]
}
```

The panel refreshes this snapshot after an operator request or accepted agent outcome. It never derives a quota, status, approval or send result locally.

## Required backend validation

- authentication and audit actor;
- lease ownership, expiry and one-outcome idempotency;
- exact handle match and unique initial contact;
- campaign approval, `DO_NOT_CONTACT`, account pause and quota;
- schema validation, evidence URL validation and content size limits;
- no secrets in responses/logs; screenshot references remain local and access-controlled.
