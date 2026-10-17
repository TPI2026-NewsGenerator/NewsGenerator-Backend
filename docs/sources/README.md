# Sources

The feeds a profile reads beyond the shared ones of `db/rss-links.js`: the ones found for its interests,
the ones the reader adds by hand, from a file, from a search of the directory and the web, from what a
search missed, or among the ones other readers have. Every reader's sources are read for every reader
(since 8.10.2026), those whose address may hold a key aside; the ones listed on a profile are the ones its
reader looks after: trusted with a star, removed, or kept when the thumbs left them out.

Code: `routes/feed-router.js`, `controllers/feed-controller.js`, `services/source-service.js`,
`services/discovery-service.js`, `services/recommendation-service.js`, `services/feedback-service.js`,
`services/utils/feed-finder.js`, `feed-bridge.js`, `feed-directory.js`, `feed-limits.js`, `public-url.js`,
`google-news.js`, `gdelt.js`, `media-cloud.js`, `meaning-judge.js`, `allocation.js`, `models/feed-model.js`;
client `client/src/features/briefing/components/` (`SourceList`, `AddSources`, `ImportSources`,
`RecommendedSources`) and `client/src/features/search/components/source-suggestions/`.

## Overview diagrams

- [05-sources](05-sources.png) — class diagram of the whole feature ([source](05-sources.puml))
- [Discovery/07-discovery](discovery/07-discovery.png) and
  [Discovery/23-discovery-sequence](discovery/23-discovery-sequence.png) — the sources found for a profile
- Client side: [client-03-profiles](../../../client/docs/profile/client-03-profiles.png)

## Sub-features

- [Discovery](discovery/README.md) — the media Google News then Media Cloud name for each interest, the feed
  of their section confirmed by the vectors and the AI; 60 per profile, pruned after 14 days with nothing.
- [Added by hand](added-by-hand/README.md) — a site, a search of Feedly and of the web, a file of sites
  checked 25 at a time; the feed finder, RSS-Bridge, the limits (800 sources, 50 through the bridge).
- [Recommended](recommended/README.md) — the feeds of the other profiles with 3 news and 2% on the interests
  in 7 days, confirmed by the AI (`confirmOnSubject`), added by their id.
- [Missing sources](missing-sources/README.md) — after a search, `POST /feeds/suggestions`: Google News and
  GDELT name the media not read, their news shown read-only, their feed on the search to add.
- [Trusted and thumbs](trusted-and-thumbs/README.md) — the star, the sources the thumbs left out, kept,
  removed and restored.
