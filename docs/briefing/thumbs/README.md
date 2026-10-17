# Briefing > Thumbs

Each card has two thumbs, "Good for me" and "Not for me". The next briefings read them: the AI that
chooses the stories gets the titles liked and refused as examples, and a source found for the profile
whose cards are refused again and again is no longer read for it (the reader can keep it on the profile
page). A thumb pressed again is taken back.

## Where

- `client/src/features/briefing/components/BriefingCard.jsx`: "For you?", the two thumbs in the margin
  (none on a news added by its link); `client/src/pages/Briefing.jsx` `vote()`: shown at once, taken back
  with an error when the server refuses it.
- `client/src/pages/Profile.jsx` and `features/briefing/components/SourceList.jsx`: a source left out
  says "left out: N not for me", and can be kept.
- API: `POST /api/briefing/:id/vote {storyId, vote: 'up' | 'down' | null}` (204);
  `GET /api/profile` (`refusedSources`), `POST /api/profile/kept-sources {key}`.

## How it works

- `BriefingService.vote` (`services/briefing-service.js`): the briefing id and the `storyId` positive
  integers (404, 400), the vote `'up'`, `'down'` or `null`. `BriefingModel.vote` writes `vote` and
  `votedAt` on the card in `briefings.items` (jsonb), in one statement, only on a ready briefing of this
  user; 0 rows is 404. A news added by its link has a negative `storyId`: no thumb.
- Each card keeps `feedUrls`, the feeds its articles came from, never a search of Google News (that is the
  interest itself): a refused card is blamed on them.
- At each briefing, step ranking, `FeedbackService.of(profileId)` (`services/feedback-service.js`) reads
  the votes of the last 30 days (`FEEDBACK_DAYS`), one per story, its last one (`BriefingModel.votes`): a
  card that comes back and gets two thumbs is one opinion, not two refusals.
- `examplesOf` (`services/utils/feedback.js`): the 15 newest titles liked and 15 refused
  (`MAX_EXAMPLES`), given to the AI that chooses (`selectStories`, `services/utils/profile-ai.js`), which
  is told to look for what makes them alike rather than refuse every news of the same people. The refusals
  are titles, not vectors: on the benches, refusals as vectors removed good stories with the bad.
- `refusedCounts`: a feed is refused when its cards got 3 "down" at least (`MIN_REFUSED`) and at least
  twice as many "down" as "up". Never refused: the shared feeds, the ones added by hand, the ones the
  reader kept (`user_profiles.kept_sources`) and the trusted ones. So only sources found for the profile
  are left out.
- The briefing reads its feeds without the refused ones; the discovery does not find them again and they
  are not recommended (`discovery-service.js`, `recommendation-service.js`). The news of what the profile
  follows still read them.
- On the profile page, `FeedbackService.refusedSources` lists them `{url, site, refused, liked}`;
  `keep(profileId, key)` adds one to `kept_sources` (`ProfileModel.keepSource`): never left out again.
  An unknown key is 404.

## Diagrams

- [Class diagram](briefing-thumbs-class.png) ([source](briefing-thumbs-class.puml))
- [Sequence diagram](briefing-thumbs-sequence.png) ([source](briefing-thumbs-sequence.puml))
- The briefing: [08-briefing](../08-briefing.png), [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Sources > Trusted and thumbs](../../sources/trusted-and-thumbs/README.md): the sources trusted and
  the ones the thumbs left out, from the side of the sources
- [Sources > Discovery](../../sources/discovery/README.md), [Sources > Recommended](../../sources/recommended/README.md):
  a refused source not found again
- [Profile > Interests](../../profile/interests/README.md): what the AI chooses against
