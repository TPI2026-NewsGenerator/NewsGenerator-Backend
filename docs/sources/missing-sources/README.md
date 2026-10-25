# Sources > Missing sources

A search only finds what the sources publish. After a search, the reader can ask what it missed: the same
keywords are asked to Google News and GDELT, the media they name that no source of the profile reads are
listed with their news (read-only, they open at the publisher), and the ones whose feed on the search was
found can be added in one click. The sources grow from what the searches really missed.

## Where

- Client: `client/src/features/search/components/source-suggestions/SourceSuggestions.jsx` ("What this search
  misses", "Look on the web"), under the results of `client/src/pages/Search.jsx`; `FeedApi.suggestSources`
  and `importSources`.
- API: `POST /api/feeds/suggestions` `{keywords, timeframe, language}` → `{news, sources, missing, tried}`,
  then `POST /api/feeds/import` `{sources, language, subject: keywords}` (`routes/feed-router.js`,
  `FeedController.suggestSources`).
- Code: `SourceService.suggest` (`services/source-service.js`), `services/utils/google-news.js`,
  `services/utils/gdelt.js`, `services/utils/meaning-judge.js`, `services/utils/feed-finder.js`.
  `POST /feeds/search` with `from: 'web'` (see [Added by hand](../added-by-hand/README.md)) runs the same
  `suggest` over 30 days.

## How it works

- **Checked** (`suggestSources`): keywords required (400); the language one of the list, else `en`. The days
  come from `timeframe.start`, none otherwise.
- **Four things at once** (`suggest`):
  - Google News (`search`): one RSS search, the keywords written with its operators (`OR`, quotes, `-`,
    `when:Nd`), in the edition of the language; 100 items at most, each naming its publisher. Every request
    of the server to Google goes through one queue, 1 s apart (`GOOGLE_NEWS_INTERVAL_MS`); a 429, a 503 or a
    captcha pauses them an hour. Google failing or paused fails the whole suggestion (502 or 500).
  - GDELT (`mediaFor`, DOC 2.0): `node:https` with a 6 s timeout and one try, 250 articles, a medium kept with
    2 of them (`MIN_NEWS`), `sourcelang` for 5 languages; refused or slow is an empty answer. Its news are
    never shown, only its media.
  - `knownMedia`: the media already read — the feeds of `db/rss-links.js` and of the profile, by their host
    and by the hosts of their cached articles (`FeedModel.articleHosts`): a feed is often served from another
    domain than its site.
  - `meaningJudge`: the keywords embedded (bge-m3), `judgeOf` at 0.45 (`JUDGE_THRESHOLD`); without the embedder
    the feeds are judged by the words (`keywordJudge`).
- **Merged** (`mergeMedia`): one medium per name (`nameOf`: bbc.co.uk and bbc.com are one), news added, the
  most present first; the ones not read are `missing`. Their news, newest first, 25 at most (`MAX_NEWS`).
- **Their feed on the search**: the 8 first (`MAX_CANDIDATES`), 4 at a time, through
  `findFeeds(site, {language, subject: keywords, judge})`: the page, its sections named by the keywords, its
  page of feeds, Feedly, its news sitemap, RSS-Bridge last; each feed's 30 newest news judged
  (`subjectStats`), the best by `subjectScore`. A medium is offered only when its feed has 2 news on the
  search (`isOnSubject`); a site read through the bridge is offered with no address (`forClient`).
- **Added**: the ticked ones, with a category, go to `POST /feeds/import` with the keywords as `subject`: each
  feed read again, a bridge site's feed built again on its section about them (see
  [Added by hand](../added-by-hand/README.md)). They become sources of the profile, read for every reader.
- **Offline**: `scripts/find-missing-sources.js` sweeps the missing media without anybody waiting (GDELT
  waited 30 s and tried again); `scripts/check-coverage.js`, `find-feeds.js`, `import-awesome-feeds.js` feed
  the shared list `db/rss-links.js`.

## Measured

- Judged by meaning and offered only on the search (`bench/web-quality.mjs`, 9 searches in French and
  English): 21 feeds offered, about 16 on the search; judged by the words and offered even off it, 45 and about
  7 (the main feed of midilibre.fr for the video refereeing of Ligue 1, its sample the weather).
- Having the AI sort Google's news first and trying only the media of its answers: 10 feeds instead of 21,
  left out.
- The judge makes the search wait on the embedder: about 20 s, 13 minutes once while its GPU was busy with
  something else. The client says about a minute (40 to 70 s measured, comment of `SourceSuggestions.jsx`).
  ([the former README](../../archive/readme-features-2026-10-24.md), "Missing sources")

## Diagrams

- [Class diagram](sources-missing-sources-class.png) ([source](sources-missing-sources-class.puml))
- [Sequence diagram](sources-missing-sources-sequence.png) ([source](sources-missing-sources-sequence.puml))
- Feature overview: [05-sources](../05-sources.png)

## See also

- [Added by hand](../added-by-hand/README.md): `findFeeds`, RSS-Bridge and `/feeds/import` in detail
- [Discovery](../discovery/README.md): the same media and feed finding, for the interests of a profile
- [Search](../../search/README.md): the search this panel completes
