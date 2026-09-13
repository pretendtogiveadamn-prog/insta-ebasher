# CRM and states

## One record per artist

The canonical key is `leadId`; Instagram handle is unique case-insensitively. Preserve every source and outcome in history instead of overwriting it.

```json
{
  "leadId": "uuid",
  "instagram": "exact_handle",
  "name": null,
  "status": "REVIEW",
  "doNotContact": false,
  "research": {
    "artistVerdict": "artist|uncertain|not_artist",
    "confidence": 0,
    "sources": [],
    "evidence": [],
    "genre": null,
    "location": null,
    "followers": null,
    "lastActivityAt": null,
    "studioSignal": false,
    "beatSellerSignal": false
  },
  "outreach": {"firstDmAt": null, "campaignId": null, "scriptId": null},
  "contact": {"phoneRaw": null, "phoneNormalized": null, "email": null},
  "future": {"typeRaw": null, "typeGroup": null, "category": null, "stage": null},
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Private contact data must never be displayed in an unprotected export or sent to an agent unless the specific later workflow requires it.

## V1 state machine

```text
FOUND -> REVIEW -> READY_FOR_IG_OUTREACH -> IG_CONTACTED -> IG_REPLIED
                  \-> REJECTED
any non-terminal state -> DO_NOT_CONTACT
```

- `FOUND`: candidate created with source/evidence.
- `REVIEW`: uncertain or unapproved candidate; no contact permitted.
- `READY_FOR_IG_OUTREACH`: human-approved lead eligible for campaign matching.
- `IG_CONTACTED`: accepted first-DM outcome; one and only one initial DM.
- `IG_REPLIED`: new inbound message is recorded.
- `REJECTED`: explicitly not an artist/target; retain for dedupe.
- `DO_NOT_CONTACT`: terminal contact block. It overrides all other statuses.

## Future fields from the supplied brief

The CRM reserves data for `PHONE_RECEIVED`, `IMESSAGE_ACTIVE`, `TYPE_CONFIRMED`, `BEATS_SENT`, `QUALIFIED`, `CALL_BOOKED`, `SOLD`, `FOLLOW_UP` and `LOST`. Do not implement their automation in V1. This prevents re-designing the record later without pretending the modules exist.
