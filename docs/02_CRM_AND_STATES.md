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

Private contact data must never be sent to an agent unless a specific later workflow requires it. V1 has no export endpoint.

## V1 state machine

```text
FOUND -> REVIEW -> READY_FOR_IG_OUTREACH -> IG_CONTACTED -> IG_REPLIED
                  \-> REJECTED
any non-terminal state -> DO_NOT_CONTACT
```

- `FOUND`: candidate created with source/evidence.
- `REVIEW`: uncertain or unapproved candidate; no contact permitted.
- `READY_FOR_IG_OUTREACH`: client-authorized or delegated-approved lead eligible for campaign matching.
- `IG_CONTACTED`: accepted first-DM outcome; one and only one initial DM.
- `IG_REPLIED`: new inbound message is recorded.
- `REJECTED`: explicitly not an artist/target; retain for dedupe.
- `DO_NOT_CONTACT`: terminal contact block. It overrides all other statuses.

## Transition matrix (enforced by backend)

```text
review   -> ready | rejected | dnc
ready    -> contacted | unknown | rejected | dnc
contacted-> replied | phone | unknown | dnc
replied  -> phone | dnc
phone    -> replied | dnc
unknown  -> ready (operator unblock) | rejected | dnc
rejected -> dnc
dnc      -> TERMINAL (no transitions)
```

Same-state writes are no-ops. Any invalid transition is rejected with `Invalid transition: <from> -> <to>`.

## Blocklist

An explicit opt-out from a handle that is not in the CRM is recorded in the `blocklist` table with an operator alert. A later research candidate with a blocklisted handle is created directly in `DO_NOT_CONTACT`.

## Notifications

The operator is notified on every new inbound reply (not only phone/email/opt-out). Retry is available from the panel for notifications that are not `sent`.

## Delegated approval

When the client explicitly delegates review in the brief, the agent can auto-approve only strong candidates: `artist`, confidence 80+, 100+ followers, US fit, own music posts and a public music link or clear music bio. All other candidates remain in `review` for later inspection.

## Phone rule

V1 accepts US phone contacts only. An explicit 10-digit US number, an 11-digit number beginning with `1`, or the `+1` E.164 form is stored as raw text and normalized to `+1XXXXXXXXXX`. Any other format remains an unnormalized fact and must not be treated as a usable phone contact.

## Future fields from the supplied brief

The CRM reserves data for `PHONE_RECEIVED`, `IMESSAGE_ACTIVE`, `TYPE_CONFIRMED`, `BEATS_SENT`, `QUALIFIED`, `CALL_BOOKED`, `SOLD`, `FOLLOW_UP` and `LOST`. Do not implement their automation in V1. This prevents re-designing the record later without pretending the modules exist.
