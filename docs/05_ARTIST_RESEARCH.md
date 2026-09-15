# Artist research and qualification

## Goal

Find active musicians who plausibly match the operator's brief. The agent recommends and may approve only when the brief explicitly delegates that decision.

## Bounded discovery sources

The server job may permit one or more of:

- followers/following/comments of a relevant producer;
- artists found from an approved artist seed;
- recording studio followers, tagged posts or comments;
- producer/BeatStars/beat-store audience;
- an operator-supplied handle.
- a bounded Instagram Search query for the requested genre, artist type or city (for example, `Philly drill artist` or `R&B singer Miami`).

Each lease specifies the exact seed, allowed source types and target count. Recursive discovery is a series of separate leases, never an infinite crawl.

## Simple research routine

When the operator says “find R&B artists” or “find Philly drill artists”, treat the genre as a **target**, not as proof.

1. Start from the lease source. If no handle was supplied, use the lease’s bounded Instagram Search seed. Do not invent a broad crawl.
2. Open a candidate profile. Check whether the account is actually an artist: own music posts, recent releases, performance/studio content, or a linked music profile.
3. Check up to three useful pieces of public evidence: two recent/pinned posts or Reels, plus one linked music/release page if available. Stop once the result is clear.
4. Check target-genre fit from the work and music context: release/video captions, track or playlist metadata, linked music profiles, collaborators, producers and relevant scene tags. Bio and city are only supporting context, never sufficient by themselves.
5. Submit every inspected profile with factual links and notes, so it is remembered. If artist status is clear but target fit is unclear, use `uncertain`. A clear non-artist is rejected; an artist that misses the current brief remains in review and is excluded from that batch, not erased.

The agent does not pretend to be a music critic. It never labels a genre solely from appearance, slang, follower count, city or one bio phrase. If the public evidence cannot establish the requested fit, it is not a target lead.

## Evidence rubric

### `artist`

Require at least one strong, attributable and reasonably current signal:

- music profile/release on Spotify, Apple Music, SoundCloud, YouTube Music or equivalent;
- explicit artist/rapper/singer/musician bio plus original music content;
- original release, music video, performance, studio session or release promotion clearly tied to the handle;
- credible link hub leading to the account's own music.

### Supporting signals

These raise confidence but cannot independently justify outreach: recent snippets, studio/rehearsal content, a stated genre, tagged producer/engineer/studio relation, active release promotion, BeatStars/beat-store signal.

### `uncertain`

Use this for a generic creator/lifestyle account, a follower/commenter of a producer without music proof, reposted music with unclear authorship, stale account, or any missing attribution.

### `not_artist`

Use only for clear contrary evidence: brand, label, producer, studio, meme page, unrelated professional account or a clearly non-music account where the job requests artists.

## Never use

Appearance, race, ethnicity, language style, follower count alone, geographic location alone or assumptions about income/buyer intent.

## Candidate quality checklist

- Exact handle captured.
- Source and URL captured.
- At least one factual evidence item with a source URL and concise note.
- Verdict follows the rubric.
- Genre/location/followers are `null` if not plainly observed.
- Existing lead/opt-out status checked by backend before review or contact.
