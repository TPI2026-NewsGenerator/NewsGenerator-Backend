# Sources > Recommended

The server already reads the feeds of every reader. Among those of the other profiles, it recommends the
ones that published on this profile's interests in the last 7 days, once the AI has confirmed that their
titles are really on them. The reader adds one, or all, in a click; only ids are sent, so every address
added is one the server already reads.

## Where

- Client: `client/src/features/briefing/components/RecommendedSources.jsx` ("Read by other readers on your
  interests"), under "Add sources" of `client/src/pages/Profile.jsx`; asked again when the discovery status
  or the interests change (`reloadKey`). `FeedApi.getRecommended`, `addRecommended`.
- API: `GET /api/feeds/recommended`, `POST /api/feeds/recommended` `{ids}` (and `needsProfile`)
  (`routes/feed-router.js`, `FeedController.getRecommended` / `addRecommended`).
- Code: `services/recommendation-service.js`, `FeedModel.recommendedFeeds` (`models/feed-model.js`),
  `confirmOnSubject` (`services/utils/profile-ai.js`).

## How it works

- **Excluded first** (`recommended`): the shared feeds of `db/rss-links.js`, the feeds the thumbs of this
  profile left out (`FeedbackService.of`), the ones the reader removed (`removed_sources`); and the media the
  profile already reads, by any of its feeds (`knownMedia` on its own and removed feeds): a second section
  of goal.com is no new source.
- **Scored in SQL** (`recommendedFeeds`): the feeds of the other profiles (`user_feeds`, one row per url, the
  ones found for a profile first), not already in this profile; their articles of the last 7 days with
  vectors, each scored on the closest interest of the profile itself (`title_dense <#> dense`). A feed needs
  3 titles at 0.45 (`MIN_RELEVANT`, `JUDGE_THRESHOLD`) and 2% of its news (`MIN_RELEVANT_SHARE`); the 60
  most relevant come back, each with its 12 best titles on the interests.
- **Private addresses out**: `looksPrivate` (`services/utils/feed-limits.js`) drops an address with a user
  and password, a parameter named like a key (`key`, `token`, `auth`…), or a random key or a UUID in it.
- **Confirmed by the AI**, 4 feeds at a time until 20 are kept: `confirmOnSubject(interests, 12 titles)`
  (gemma4:31b, Gemini when Ollama fails) answers which titles are on an interest. The verdict is kept 24 h per
  profile and feed while the interests are the same (5000 kept at most, in memory). `afterConfirmation`
  scales `relevant` by the share confirmed and drops the feed under 3 or 2%; the AI not answering leaves the
  feed as the vectors judged it, and it is asked again next time.
- **Shown**: 20 at most (`MAX_RECOMMENDED`), the most relevant first: site (`siteOf`, the real site for a
  bridge feed), `url` (null on our RSS-Bridge), category, language, news, relevant, 2 samples.
- **Added** (`add`): 1 to 20 integer ids (400 otherwise). The list is computed again and only an id still
  recommended is added, with the server's own url, as a source added by hand (`origin 'user'`, never
  removed by the server), within 800 sources and 50 on the bridge. `{feeds, errors}`. They are not read at
  once: they are already read for their other reader.

## Measured

- 3 news in a week alone let in a Paris outings feed and a tennis one for a TCG profile (1.2% and 0.6% of
  their news); on 4 profiles (`bench/recommend-scores.mjs`) the wrong ones were all under 1.5% of their
  news, the right ones at 2.5% and more: hence 2%.
- Without the AI, an interest on the economics of refereeing got a tennis feed (titles at 0.47 to 0.51) and a
  law firm feed (0.45 to 0.47) (comment of `recommendation-service.js`).

## Diagrams

- [Class diagram](sources-recommended-class.png) ([source](sources-recommended-class.puml))
- [Sequence diagram](sources-recommended-sequence.png) ([source](sources-recommended-sequence.puml))
- Feature overview: [05-sources](../05-sources.png)

## See also

- [Discovery](../discovery/README.md): the same AI check of the titles, on the media of the web
- [Trusted and thumbs](../trusted-and-thumbs/README.md): the sources left out and removed, never recommended
- [Added by hand](../added-by-hand/README.md): the other ways to add a source
