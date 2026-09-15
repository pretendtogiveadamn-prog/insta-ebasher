# Product scope

## V1 funnel

```text
seed/source -> research candidate -> delegated or human review -> approved lead
-> first Instagram DM -> incoming reply -> operator alert
```

One artist has one CRM record. Modules add facts to the same record; they never create competing lists.

## Roles

| Role | Owns | Must not own |
|---|---|---|
| Operator | Brief, approval policy, campaign approval, live-send confirmation | hidden state or browser automation policy |
| Backend | CRM, state machine, quotas, leases, dedupe, audit, notifications | Chrome navigation |
| Codex agent | Evidence gathering and leased Chrome actions | direct database writes, target selection, quota decisions |
| Panel | API state and operator controls | business rules |

## V1 in scope

- Research from producer, studio, artist, manually supplied seeds and bounded Instagram Search seeds.
- Evidence-based artist qualification and review, which the operator may delegate to the agent through an explicit brief.
- First DM only, from an approved campaign and only through an action lease.
- Reply/phone/email/opt-out event capture and operator notification.
- Auditable state history in the local panel.

## Not in V1

- iMessage/Mac control, beat delivery, sales replies, booking, payments and automatic follow-ups.
- Account procurement, proxies, cookie import/export, browser profiles, stealth/anti-detect or synthetic human interactions.

## Operational policy

The backend starts in dry-run. Its initial limit is **35 first DMs per rolling 24 hours**. The server can lower it. Any future maximum of 40 is an explicit backend configuration, never something an agent decides or targets.
