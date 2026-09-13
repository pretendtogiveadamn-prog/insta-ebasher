# Artist research and qualification

## Goal

Find active musicians who plausibly match the operator's brief. The agent recommends; the human approves contact.

## Bounded discovery sources

The server job may permit one or more of:

- followers/following/comments of a relevant producer;
- artists found from an approved artist seed;
- recording studio followers, tagged posts or comments;
- producer/BeatStars/beat-store audience;
- an operator-supplied handle.

Each lease specifies the exact seed, allowed source types and target count. Recursive discovery is a series of separate leases, never an infinite crawl.

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
- At least one factual evidence item and observation time.
- Verdict follows the rubric.
- Genre/location/followers are `null` if not plainly observed.
- Existing lead/opt-out status checked by backend before review or contact.
