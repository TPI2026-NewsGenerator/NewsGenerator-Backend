# Following > Names and words

Next to the items of Wikidata, a profile follows names or words exactly as written, 20 at most: a name Wikidata
does not have as one item ("LFF", "Vadims Ļašenko"), a product, a term. Every news of the window that writes one,
from every feed and whatever its relevance, is in the briefing, in the tab of what the profile follows. A name
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
- **In the briefing.** `watchedNews` (`services/briefing-service.js`) asks `FeedModel.searchArticles` for the
  words as exact phrases, on every feed of the window, then `newsOfTerms` keeps the news naming one as a whole
  word, one per story, the 100 newest per word (`WATCHED_PER_TERM`), all counted; they are stored in the
  briefing (`briefings.watched`). When the briefing is read, `followTerms` gives the items in the briefing and
  the words, and `withMarks` marks them in the cards (a card naming one, or only one of its other angles, is
  "found").

## Diagrams

- [Class diagram](following-names-and-words-class.png) ([source](following-names-and-words-class.puml))
- [Sequence diagram](following-names-and-words-sequence.png) ([source](following-names-and-words-sequence.puml))
- The whole feature: [10-following](../10-following.png), [27-following-sequence](../27-following-sequence.png);
  the client: [client-06-following](../../../../client/docs/following/client-06-following.png)

## See also

- [Wikidata items](../wikidata-items/README.md): the items followed, and how their news are found.
- [Names on cards](../names-on-cards/README.md): the names a card shows, the source of the suggestions.
- [Ingestion > Names](../../ingestion/names/README.md): the names of the news and the queue of Wikidata.
