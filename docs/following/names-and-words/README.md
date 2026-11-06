# Following > Names and words

Next to the items of Wikidata, a profile follows names or words exactly as written, 300 in all with the items: a
name Wikidata does not have as one item ("LFF", "Vadims Ļašenko"), a product, a term. Every news of the last 30 days that writes
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
  (`cleanName`); a word already followed, whatever its case, is answered as it is; 300 in all
  with the items (`MAX_FOLLOWED`; `MAX_WATCH_TERMS`, 300, for the words alone), each 2 to 60 characters (`cleanWatchTerms`, `services/utils/watch-terms.js`); saved
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
  days) is another choice. The items and the words are searched at the same time (see below). The answer is
  `{status, limit, partial, groups: [{term, qid, count, hours, limit, news: [..., marks]}]}`; `marks` are the
  places of the terms in the titles and excerpts (`marksOf`). A person with a name of several words is not searched by a
  family name alone when many people carry it (`searchNamesFor`, `commonNames`): the Wikidata aliases of Carlos Velasco
  Carballo hold "Velasco", the name of 64 different first words among the persons the tagger met (García 581, Silva 470,
  Müller 189), which filled his tab with other Velascos. The limit is `COMMON_NAME_FIRSTS` (50), kept a day, measured
  on the persons met: Messi 38, Infantino 22, Čeferin 7, Kuipers 7, Rosetti 4 stay searched by their family name; the news of a
  name taken out are still found by the full names and by the item the tagger links. The words the reader added stay. The
  client asks when the tab is opened
  (`useFollowing`, `FollowingNews`, `FollowLimit`, the Slider of shadcn on Radix) and again when the bar moves.
- **In background (300 names).** A long list takes minutes: the search runs as a briefing is written. The call
  answers `status: 'ready'` when it ends within 2.5 s (a short list, or one kept 10 minutes for the profile, what
  it follows and the number), else `'running'` with `progress: {finished, total}` (the names done) and the page
  asks again every 2 s. Several tabs or reloads share one search; 4 run at most (503 after). It stops at 170 s
  (`FOLLOWING_BUDGET_MS`, the user: 3 minutes at most for about 300 names): the next window is not started when the
  last took so long that the next, about twice as long, would end after it, and the answer says `partial`, what
  was found kept (each name tells the days it went back). Measured on the real data (3.9 million news,
  `bench/following-scale.mjs`): 200 items and 100 words (ten surnames, ten generic words) with 100 news each,
  **49 s**, 287 of the 300 names went back the month, "VAR" 101 stories in one day. The tab of 300 names is a
  list to pick from with a field to find a name (`Picker` of `WatchedNews.jsx`), tabs up to 12.
- **The items, in one search.** `briefingGroups` searches all the items at once (`namedNews` of all their names and
  qids), not one search each. The links of the names the tagger found are read from the first news of the window
  (`MentionModel.articlesNamed`, the ids grow with the days): 100 names on a day, 14 s before and 0.16 s after,
  on 30 days 0.8 s (`bench/mentions-window.mjs`). The news the tagger has not read yet (it is hours late at
  times) are asked by their texts for a few names, from 30 names all read once and filtered in memory by the
  longest word of each name (`mayName` of `name-prefilter.js`).
- **The words, by the way that suits them** (`EntityService.wordsGroups`). The texts of the news are answered by
  the trigram index in 0.3 to 0.6 s per word and per window, whatever the window and the rarity of the word
  (25 names: 15 s on a day and 31 s on a month; the exact phrases of the first version of this tab, with their
  accents in classes, took over 270 s for 100 words on a day). So the texts are asked for few words:
  - the names (several words, or a surname alone) by the names the tagger found, accents and case aside, as for an
    item, and the news it has not read yet by their texts;
  - the generic words and the acronyms (one word in lower case or in capitals: "VAR", "derby") by the texts, as a
    whole word read as written: the tagger meets "VAR" in a quarter of its news and under three kinds (a place, a
    body, a person), and its key forgets the capitals; with the names the tagger never met, 30 words at most, in
    lots of 10, 3 lots at once. A generic word beyond them is searched by the tagger's names.
- **Translated.** A news written in another language than the reader's has its title, and the words of its
  description a row shows (the excerpt: around the name when the description names it, else its beginning; none
  when it only repeats the title), translated when
  its row comes near the screen (`useTranslation` and `createTranslator` of the search, `POST /api/news/translations`,
  `NewsService.translateNews`: the AI translates cached articles only, 20 texts a call, the translations kept in
  memory), shown marked "translated from German" with the title and the words as written under them in italics,
  the terms marked there. The terms are marked in the translation too: each news of the answer carries `terms` (the words of it
  that were marked and the names its group is followed by, 20 at most), sent with the translation (`terms: {url: [name]}`),
  and the server answers their places in the translated text (`marks`, `excerptMarks`, `Filter.highlights`, the rule of the
  text as written). The rows are asked by the `link` of each news (the address of the feed; the `url` shown
  can be the decoded address of a Google News link, which the cache does not know). The excerpt is asked as the
  page shows it (`excerpts: [{url, text}]`, its "…" at the ends kept): the server translates it only when it is a
  passage of the description of that news, so the AI is still no translator for any text. Measured for the profile
  following Čeferin (reader in English): the first 8 news, in 5 languages, 2.2 s for the titles, and 8 excerpts
  in 3.3 s. Only the rows shown are asked ("show the N others" asks the rest).
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
