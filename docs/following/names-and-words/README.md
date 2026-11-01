# Following > Names and words

Next to the items of Wikidata, a profile follows names or words exactly as written, 20 at most: a name Wikidata
does not have as one item ("LFF", "Vadims Ļašenko"), a product, a term. Every news of the last 30 days that writes
one, from every feed and whatever its relevance, is in the briefing, in the tab of what the profile follows. A name
also has a page of its own with its news, and the names met card after card are suggested.

## Where

- Client: `client/src/pages/Following.jsx` (`FollowingPage`, `/following`: the text typed followed as written,
  the words followed, the names suggested), `client/src/pages/Name.jsx` (`NamePage`,
  `/following/name/:name`), the tab "What you follow" of `client/src/pages/Briefing.jsx`
  (`client/src/features/briefing/components/WatchedNews.jsx`, `WatchedNews` and `Term`),
  `client/src/features/entities/entityApi.js` (`EntityApi`, `pageOf`).
- API (`routes/entity-router.js`): `GET /api/entities` (`{entities, words, limits}`),
  `POST /api/entities/words {word}`, `DELETE /api/entities/words/:word`,
  `GET /api/entities/name?name=&hours=`, `GET /api/entities/suggestions`; all but the list need a profile.

## How it works

- **Followed as written.** `EntityService.addWord` (`services/entity-service.js`): quotes and commas taken out
  (`cleanName`); a word already followed, whatever its case, is answered as it is; 20 at most
  (`MAX_WATCH_TERMS`), each 2 to 60 characters (`cleanWatchTerms`, `services/utils/watch-terms.js`); saved
  in `user_profiles.watch_terms` (`ProfileModel.setWatchTerms`). `removeWord`: 404 when not followed. A word
  that was a name of an item followed was taken out of the words by `db/add_follow_in_briefing.sql`: the item
  brings its news now.
- **The page of a name.** `namePage(profileId, name, hours)`: 2 to 60 characters, hours 24 to 168 by days.
  `MentionModel.qidsOfKey(mentionKey(name))` gives the items the tagger linked this writing to: exactly one,
  and the client opens `/following/:qid` instead. `MentionModel.want({key})` puts the name first in the queue
  of Wikidata (`mentions.wanted_at`): next time it may be an item. Its news come from `namedNews`, as for an
  item: the names the tagger found, and the news not tagged yet by their text (see
  [Wikidata items](../wikidata-items/README.md)).
- **Suggestions.** `suggestions(profileId)`: the cards of the ready briefings of the last 14 days
  (`BriefingModel.recentCards`), their names (the cards written before 13.10.2026 get theirs from the news of
  their story now, 40 stories at most, `namesOfCards`), then `suggestedNames` (`services/utils/card-names.js`):
  the names met on 2 cards at least, 8 at most, the most met first, neither an item followed nor a writing of a
  word followed ("Infantino" of "Gianni Infantino"). The client follows an item by its qid, a name without one
  as a word.
- **In its tab, not in the briefing.** The news of what is followed are searched when the tab "Following" of the
  briefing page is opened (`GET /api/briefing/following?limit=`, `BriefingService.following`,
  `followingNews` in `services/briefing-service.js`), not when a briefing is written: a name followed now has its
  news at once, and the briefing no longer waits for them. The reader chooses how many news each name should
  have, on a bar of 10 to 100 in the tab (`limit`, `WATCH_LIMITS`, 100 by default, kept in the browser), and the
  search goes back until it finds them (`followedNews`, `untilEnough`): 1, 2, 4, 8, 16 then 30 days
  (`WATCH_STEPS`, the retention), each name read again over the next window only while it has fewer stories than
  wanted. A frequent name is done in a day or two, a rare one takes the month; the window of the briefing (1 to 7
  days) is another choice. For the words, `watchedNews` asks `FeedModel.searchArticles` for the exact phrases of
  the names still open, on every feed, then `newsOfTerms` keeps the news naming one as a whole word, one per
  story, the newest `limit` per word, all counted over the window read. The answer is `{limit, groups: [{term,
  qid, count, hours, limit, news: [..., marks]}]}`, kept 10 minutes for the profile, what it follows and the
  number; `marks` are the places of the terms in the titles and excerpts (`marksOf`). The client asks when the
  tab is opened (`useFollowing`, `FollowingNews`, `FollowLimit`, the Slider of shadcn on Radix) and again when
  the bar moves.
- **Noted for the directory.** The directory takes out the feeds that serve no reader, and a medium shown in a
  briefing of the last 14 days serves one (`DirectoryModel.usage`, which reads `briefings.watched`). The news
  shown in the tab are written to `briefings.watched` of the last ready briefing of the profile
  (`rememberShown`, never failing the answer), so the media of the names followed still count. The briefing no
  longer writes that column itself, and its answer no longer carries it; the briefings before 1.11.2026 keep
  theirs in the database, unseen (no page shows an old briefing).
- **What the tab says.** The count is the stories of the window read, not of the month: "137 stories in 2 days"
  for a word that had its 100 in two days, "90 stories in 30 days" for a person. When more stories name it than
  are listed, "The 20 newest are listed, back to 28 Oct". The tab is shown to a profile that follows an item in its
  briefing or a word (`EntityApi.list`).
- **Why a number of news and not a bar of days** (the user's idea, 1.11.2026): one choice for the reader, and
  the cost follows the name. Measured on 3.9 million news (`bench/watched-window.mjs`, `bench/watched-steps.mjs`),
  the same names ("VAR", "UEFA", "Dario Amodei", the items Čeferin and Rosetti): 30 days for all took 73 s
  (the items 1 to 2 s, a word about 2 s, but "VAR" alone 72 s, the trigrams of the index cutting nothing on three
  letters: 6 s on 2 days, 21 s on 7); 100 news wanted took 11.5 s ("VAR" 105 stories in 1 day, "UEFA" 137 in 2,
  Čeferin 90 and Dario Amodei 59 over the 30 days, Rosetti 2); 20 news wanted 6.6 s. For the profile following
  Čeferin and Rosetti only, the tab opened cold takes 3.8 s, 0.1 s again. Grouping 15,905 news by story in
  JavaScript is 1.3 s: it is not the cost. Not built: a full-text index (whole words, exact), or matching each
  new news against the words at ingestion, which a rare word of three letters would still need.

## Diagrams

- [Class diagram](following-names-and-words-class.png) ([source](following-names-and-words-class.puml))
- [Sequence diagram](following-names-and-words-sequence.png) ([source](following-names-and-words-sequence.puml))
- The whole feature: [10-following](../10-following.png), [27-following-sequence](../27-following-sequence.png);
  the client: [client-06-following](../../../../client/docs/following/client-06-following.png)

## See also

- [Wikidata items](../wikidata-items/README.md): the items followed, and how their news are found.
- [Names on cards](../names-on-cards/README.md): the names a card shows, the source of the suggestions.
- [Ingestion > Names](../../ingestion/names/README.md): the names of the news and the queue of Wikidata.
