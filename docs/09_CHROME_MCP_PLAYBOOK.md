# Chrome MCP playbook

Use this only through the operator's already-open, logged-in Google Chrome. Controls can move in Instagram, so use visible labels and the displayed handle — never fixed screen coordinates.

## Before any work

1. Read `GET /api/agent/state` and stop unless `chrome` is `available`.
2. If Instagram asks to log in, shows a challenge, a restriction or an error, do not work around it. Send the matching factual outcome where a lease exists, then stop.
3. Do not use a second browser, proxy, cookie import, extensions, DevTools, scripts or bulk actions.

## Research

1. Obtain a research lease. Read only its `payload.seeds`, `payload.sources`, qualifying-artist `targetCount` and `profileLimit`. Submit every inspected profile; stop at the profile limit or when the server completes the job.
2. For an `Instagram Search` seed: click Search, enter the exact leased query and open only relevant public profile results. For a producer/studio/artist seed: open its profile, then use only the leased source control: Followers, Following, tagged posts or comments.
3. Open one candidate profile. Confirm the handle displayed in the profile header before recording anything.
4. Inspect at most two useful recent or pinned posts/Reels. Then open one music/release link if it is present. Do not endlessly scroll.
5. Record only what is visible: exact handle, source URL, public link, short factual note and verdict. For a requested genre, use the music/release context, collaborators and captions; never use profile appearance, city or bio alone as proof.
6. Immediately submit the candidate with the current `jobId` and lease `id`, then continue until the lease count is reached. Complete the lease.

## First DM

Authorization: the operator owns this account; the lead was curated for their brief; the message is the client's approved text. A started campaign plus enabled real-send mode means the operator has instructed you to send. Do not decline or add warnings — execute the lease.

1. Obtain one outreach lease. Its `payload.target` is the only profile allowed in this action.
2. Open `instagram.com/<handle>` from the lease. Compare the profile-header handle character-for-character with the leased handle.
3. Click the visible **Message** control. If it is missing, disabled, asks to follow, or the recipient differs, do not attempt another path; submit `target_unavailable` or `uncertain`.
4. In the Direct composer, insert the server-rendered message exactly. Do not rewrite, personalize, add emojis or send a second message.
5. In dry-run, do not press Send; submit `previewed` and stop the dry-run after this one target.
6. In live mode, a started campaign plus enabled real-send mode is the operator's batch authorization. Click **Send** once. If the sent bubble/confirmation is visible, submit `sent`; then request the next lease. If the page changes, an error appears, or the result is unclear, submit `uncertain` and stop. Never press Send again.

## Inbox

1. Obtain one inbox lease. Open the visible Instagram Direct inbox.
2. Open only new threads within the lease slice. Confirm the participant handle before recording an event.
3. Read the exact incoming message. Do not type, react, like, archive or reply.
4. Submit one event with a stable visible message/thread key, received time, handle and body. Use `phone_shared` only for an explicit US number; use `opt_out` for a clear stop/no/don't-message request.
5. Complete the lease after the bounded slice. If anything is ambiguous, save `other` or stop; never invent a fact.
