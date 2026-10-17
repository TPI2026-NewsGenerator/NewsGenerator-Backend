# Sources > Discovery

The sources of a profile are found from its interests, in background: the media that wrote on each
interest this week (Google News), then the national and regional press only Media Cloud names. In each
medium the feed of its section on the subject is kept, when its news are really on the interests. The
feeds found are read at once, so the next briefing already has them, and the ones that bring nothing on
the profile any more are removed.

## Where

- Client: `client/src/pages/Profile.jsx`, section "Your sources": the status under "Search for sources"
  (`discovery.status`, `discovery.phase`), the profile asked again every 5 s while it runs (`POLL_MS`), the
  button "Find more sources" (`ProfileApi.rediscover`). The feeds found are listed by `SourceList` as
  "found for you".
- API: no route of its own. It is started by `PUT /api/profile`, `POST /api/profile/profiles`, the signup
  (`ProfileService.store`) and `POST /api/profile/discover` (`ProfileService.rediscover`); by
  `DiscoveryService.resumeInterrupted()` when the server starts (`server.js`). `DiscoveryService.prune` also
  runs before each briefing.
- Code: `services/discovery-service.js`, `services/utils/allocation.js`, `services/utils/google-news.js`,
  `services/utils/media-cloud.js`, `services/utils/feed-finder.js`, `services/utils/meaning-judge.js`,
  `services/utils/profile-ai.js` (`confirmOnSubject`), `models/profile-model.js`.

## How it works

- **Start** (`DiscoveryService.start`): `discovery_status = 'running'` and returns at once. The work is
  chained per profile in memory: asked again while it runs, it runs once more after, with the profile as
  it is then. `phaseOf()` says `google` then `press` while it runs.
- **Prune first** (`prune`): `ProfileModel.profileFeedRelevance` counts, per feed found for the profile,
  its news of the last 14 days (`RELEVANCE_DAYS`) and the ones at 0.45 (`JUDGE_THRESHOLD`) with an interest
  of the profile itself. `staleFeeds` removes the ones with none, once 14 days old or 30 news
  (`MIN_NEWS`); the kept and trusted ones stay.
- **Room**: 60 feeds found per profile (`MAX_PROFILE_FEEDS`), 20 new ones per discovery
  (`MAX_NEW_PROFILE_FEEDS`); no room, nothing is looked for. The interests read are the profile's own
  with a vector (`interestsForDiscovery`), never a project's.
- **Only new media**: `knownMedia` (`services/source-service.js`) names the media of the shared feeds
  (`db/rss-links.js`), of the profile's feeds, of the ones its thumbs left out (`FeedbackService.of`) and
  of the ones the reader removed (`removed_sources`), by the hosts of their articles too.
- **Phase `google`**: per interest, each of its searches (`fr:arbitrage football`) asked to Google News over
  7 days (`SEARCH_DAYS`); the media named, the most present first, tried language by language
  (`tryPerLanguage`: 2 kept or 5 tried per language, 3 at a time). For a medium, `findFeeds` with the
  keywords and sections of the interest and a judge by meaning (`judgeOf`, the vectors of every interest):
  a feed is on the subject with 2 of its 30 newest news at 0.45 (`isOnSubject`, `subjectStats`), the best by
  `subjectScore`. Then `confirmOnSubject`: the AI (gemma4:31b) reads up to 12 titles the vectors put on
  the interests (`CONFIRMED_TITLES`) and the feed stays on 2 it confirms; the AI failing keeps it.
  `allocate` shares the room among interests in turn, `withinBridgeRoom` keeps 50 RSS-Bridge feeds at most
  (`MAX_BRIDGE_FEEDS`); `addProfileFeeds` writes them in `user_feeds` (`origin 'profile'`), and they are
  read at once with the Google News searches of the profile (`IngestService.run`).
- **Phase `press`** (only with `MEDIACLOUD_API_TOKEN`): the Media Cloud searches of every interest were
  asked at the start (`pressSearches`; 2 searches a minute, an answer kept a day). The media only it named
  are tried with their own budget (2 kept or 3 tried per language), the feeds its directory knows for
  them (`knownFeeds`) as candidates too; the room left, then read at once.
- **End**: the reads awaited, `done` (with `discovered_at`); an error: `failed` with its message, shown on
  the page. A restart leaves nothing `running`: `resumeInterrupted` starts those again.

## Measured

- With the shared feeds only, a private chef had 1 relevant story in 48 h and a dog owner 2; with the feeds
  found, 8 and 32 (comment of `discovery-service.js`).
- Media Cloud (`bench/mc-measure.mjs`): 8 feeds on the subject of 11 media tried for the UEFA profile, 2 of
  20 for the trading cards. One search per language (`bench/mc-one-search.mjs`) halved the queue but lost 2
  media of 13.
- Two phases (`bench/discovery-phases.mjs`, 06.10.2026): sailing and astronomy got their 7 feeds at 7 minutes
  instead of 14; the UEFA profile 8 at 18 minutes instead of none for 43.
- The AI confirming the titles (`bench/discovery-confirm.mjs`, 4 profiles): left out the home of a newspaper,
  a feed of match previews and three off-subject feeds, kept the 8 feeds on their subject.
- Prune on the text of the news, not the title (`bench/prune-text.mjs`): 3 of 113 feeds found removed on
  the title, none on the text.

## Diagrams

- [07-discovery](07-discovery.png) — class diagram ([source](07-discovery.puml))
- [23-discovery-sequence](23-discovery-sequence.png) — the two phases, from `start` to `done`
  ([source](23-discovery-sequence.puml))
- Feature overview: [05-sources](../05-sources.png); started from [25-profile-sequence](../../profile/25-profile-sequence.png)

## See also

- [Profile > Interests](../../profile/interests/README.md): the interests and searches it reads
- [Trusted and thumbs](../trusted-and-thumbs/README.md): what is kept, left out, removed, restored
- [Missing sources](../missing-sources/README.md): the same media and feed finding, after a search
- [Added by hand](../added-by-hand/README.md): `findFeeds` and RSS-Bridge in detail
