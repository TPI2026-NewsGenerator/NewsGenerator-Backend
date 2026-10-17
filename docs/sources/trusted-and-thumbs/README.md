# Sources > Trusted and thumbs

What the reader says about their sources, directly or through their cards. A star marks a source as
trusted: its stories come first in the briefing when they fit the interests, and it is never removed. A
source found for the profile whose cards keep getting a thumb down is left out of the briefing; the reader
can keep it for good. A source found for the profile can be removed by hand: it is remembered, never found
nor recommended again, until the reader brings it back.

## Where

- Client: `client/src/features/briefing/components/SourceList.jsx` (the star, the bin, "Keep it", "Bring it
  back", the filter "Left out") and `client/src/features/briefing/sourceRows.js`, in the section "Your
  sources" of `client/src/pages/Profile.jsx` (`trust`, `keep`, `remove`, `restore`). The thumbs themselves
  are given on the cards (see [Briefing > Thumbs](../../briefing/thumbs/README.md)).
- API: `PATCH /api/feeds/:id` `{trusted}`, `DELETE /api/feeds/:id` (`FeedController.updateUserFeed`,
  `deleteUserFeed`); `POST /api/profile/kept-sources` `{key}`, `DELETE /api/profile/sources/:id`,
  `POST /api/profile/removed-sources/restore` `{key}` (`ProfileController.keepSource`, `removeSource`,
  `restoreSource`). The lists come with `GET /api/profile` (`refusedSources`, `removedSources`).
- Code: `services/feedback-service.js`, `services/utils/feedback.js`, `ProfileModel` (`kept_sources`,
  `removed_sources`, `REMOVE_PROFILE_FEED`, `RESTORE_PROFILE_FEED`), `FeedModel.trustedMedia`.

## How it works

- **One list, matched by a key**: every source has `key = sourceKey(url)` (sha256, 16 characters,
  `services/utils/public-url.js`); a feed of our RSS-Bridge is sent with `url: null` and found again by
  its key. `sourceRows` merges the sources found, the ones added, the ones left out and the ones removed.
- **Trusted** (`updateUserFeed`): any source of the profile, found or added (`user_feeds.trusted`, 404 for one
  of another profile). `FeedModel.trustedMedia` turns them into media (the site, and the medium its news
  link to most), so a trusted medium counts through any feed and through Google News. The briefing gives the
  AI, besides the 40 candidates, its stories among the 60 closest (`TRUST_POOL`), 10 at most
  (`TRUSTED_CANDIDATES`), marked "(source de confiance du lecteur)"; a trusted article leads its card. The
  discovery never prunes a trusted feed, the thumbs never leave it out.
- **Left out by the thumbs** (`FeedbackService.refusedSources` → `refusedCounts`): the last vote of each card
  of the profile's ready briefings of the last 30 days (`BriefingModel.votes`, `FEEDBACK_DAYS`), each card
  blamed on every feed that brought one of its articles. A feed with 3 cards refused at least
  (`MIN_REFUSED`) and twice as many refused as liked is left out — never a shared feed, one added by hand,
  one kept or one trusted. The briefing removes those feeds from the ones it reads (`FeedbackService.of`);
  the discovery and the recommendations never offer them again.
- **Kept** (`keepSource` → `FeedbackService.keep`): only a source currently left out, found by its key (404
  otherwise); its url is appended to `user_profiles.kept_sources`. It is never left out again, nor pruned.
- **Removed** (`removeSource`): `REMOVE_PROFILE_FEED` deletes the `user_feeds` row of this profile
  (`origin 'profile'` only) and appends `{url, site, category, language}` to `user_profiles.removed_sources`
  in one statement (0 rows: 404). The discovery treats its medium as known, the recommendations exclude it,
  and the briefing of this profile no longer reads it, even when another reader has it (`feedsOf`,
  since 17.10.2026).
  A source added by hand is deleted with `DELETE /feeds/:id` and not remembered.
- **Restored** (`restoreSource`): the removed source whose key matches (404 otherwise);
  `RESTORE_PROFILE_FEED` takes it out of `removed_sources` and inserts it back as a `profile` feed
  (`ON CONFLICT DO NOTHING`).
- **The thumbs as examples**: `examplesOf` gives the AI that chooses the cards 15 titles liked and 15 refused
  (`MAX_EXAMPLES`), as text, not as vectors.

## Measured

- Trusted media as candidates apart (`bench/trust-thumbs.mjs`, the UEFA reader with 4 media trusted): 2 cards
  of them in 5 runs of 5, 1 in 4 of 5 unmarked, never one off the profile. A bonus of the score instead put 2
  stories of a trusted medium off the profile into the 40 and pushed out the 40th the AI would have chosen
  (comments of `profile-ai.js` and `briefing-service.js`).
- The refusals as vectors removed good stories with the bad ones on the benches: the thumbs are given to the
  AI as titles (comment of `utils/feedback.js`).

## Diagrams

- [Class diagram](sources-trusted-and-thumbs-class.png) ([source](sources-trusted-and-thumbs-class.puml))
- [Sequence diagram](sources-trusted-and-thumbs-sequence.png) ([source](sources-trusted-and-thumbs-sequence.puml))
- Feature overview: [05-sources](../05-sources.png)

## See also

- [Briefing > Thumbs](../../briefing/thumbs/README.md): how a thumb is given on a card
- [Discovery](../discovery/README.md): the prune that keeps the kept and trusted feeds
- [Recommended](../recommended/README.md): never a source left out or removed
