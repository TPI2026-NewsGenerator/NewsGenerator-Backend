# Search > Search by meaning

The reader writes a sentence ("the rise of energy prices", "les décisions d'arbitrage et la VAR en Ligue
des champions") and gets the news that answer it, in every language, shown in the language chosen. The
vectors of the news bring the candidates, the AI says which ones answer the sentence and which are only
close to it, and Google News is asked the sentence too. A search with a quote, a comma or a `-word` is
searched by its words instead (see [Keywords](../keywords/README.md)).

## Where

- Client: `client/src/pages/Search.jsx` (`SearchPage.handleSubmit`, route `/search`),
  `client/src/features/search/components/feed-list/FeedList.jsx` (the answers, then "close to it"),
  `client/src/features/search/api/searchApi.js` (`SearchApi.getNews`).
- API: `POST /api/news` (`routes/news-router.js`, `NewsController.getNews`, `NewsService.getNews` and
  `NewsService.searchByMeaning` in `services/news-service.js`).

## How it works

- `NewsController.getNews` accepts only `keywords`, `category`, `language`, `timeframe`; it refuses a
  missing keyword or category, a date that is no date, and a language without sources (400). Then
  `authenticateToken` and `activeProfile` have given the user and the profile.
- The feeds read, of every language: the shared feeds of the categories (`db/rss-links.js`,
  `Links.getAllLanguagesLinks`), the profile's sources, those of every reader but an address that may hold
  a key (`FeedModel.publicFeedUrls`), the Google News searches of every profile and of the sentences
  searched in the last 30 days (`searchesOfCategories`, `sentenceFeeds`), the directory. No feed is
  fetched: only the `articles` table, filled in background.
- `Filter.hasOperators` finds no quote, comma or `-word`: the text is a sentence. At once, and while our
  feeds are searched, `webSearch` asks Google News the sentence (`sentenceUrl`, over the days searched, 30
  at most, in the edition of the language) and `IngestService.readNow` reads that feed and embeds its news.
  It is skipped when `GOOGLE_NEWS=off`, `SEARCH_GOOGLE_NEWS=off` or Google is paused after a block.
- `searchByMeaning`: `embed([sentence])` gives the bge-m3 vectors (503 "Put your words between quotes to
  find them exactly." when no embedder answers). `FeedModel.closestArticles` takes, among the news that
  have their vectors, the 80 closest by dense + 0.5 × sparse (`BY_MEANING`, `MEANING_SPARSE_WEIGHT`) and
  the 30 with the most of its words, sparse alone (`BY_WORDS`), in the language searched and in the
  other languages each; with the feed of Google, its 40 closest too (`BY_GOOGLE`).
- One line per story (or per title) goes to the AI: `sortByMeaning` (`services/utils/search-ai.js`),
  gemma4:31b through `ollamaJson`, no reasoning asked, Gemini when Ollama fails. The prompt asks a verdict
  for the news concerned only: "reponse" (answers it) or "proche" (the same subject, another place or
  aspect); the others are left out. Title and the first 160 characters of the description. Asked once
  more when the call fails.
- If the AI fails twice, the 30 closest are given unsorted, `checked: false`, and the page says they were
  not checked.
- The cards: one per story, the news in no story grouped by the trigrams of their titles
  (`groupDuplicates`, 0.25, 0.45 under 40 characters), in the order of the AI, each with `match`
  `answer` or `related`. Cards with two articles at least 0.65 alike in their texts (`closeCardPairs`)
  are asked to `mergeStories` (30 cards at most): the cards of one fact are joined. Then the facts of
  each affair on one card (`withThreads`, 12 facts not found at most, 30 articles each).
- When 5 cards or more answer (`WEB_MIN_ANSWERS`), the answer goes at once and Google's news only join the
  database for the next searches. Under 5, the search waits for Google and is run again with its feed:
  `{..., web: true}`, and the page says Google News was asked.
- The answer: `{totalResults, news, wider: null, mode: 'meaning', checked, web}`. The cards in another
  language are translated as the reader reaches them (see [Translations](../translations/README.md)).

## Measured

From the code comments and `server/README.md`:

- 13 sentences in French and English (`bench/meaning.mjs`, `meaning-ai.mjs`): the vectors alone rank a
  broad subject well but not a sentence naming someone, a place or an aspect; asked for one list, the AI
  left out news a reader would want, hence the second list. 80 + 30 news are 4000 to 7000 tokens,
  answered in 1 to 3 s; a verdict per news costs 0.4 to 2.3 s more than two lists (`bench/split.mjs`).
- Reading every language (`bench/search-languages.mjs`): "Schiedsrichter im Fußball" found 4 news in
  German only, 28 in the languages of the profile.
- Google News for few answers (`bench/vs-google.mjs`, 15 sentences, 30.09.2026): "measles outbreaks" from
  1 answer to 10, "the Swiss chocolate industry" from 0 to 11; such a search takes 5 to 11 s instead of 2
  to 5. Asked only when our sources answered little, 40% of Google's first 30 news were in none of our
  feeds (01.10.2026), hence every sentence asked.
- Joining the cards of one fact (`bench/join-cards.mjs`, 12 searches judged by hand): at 0.65 about 50
  cards joined, 2 wrongly; at 0.55 a quarter of the joins below 0.75 were wrong.

## Diagrams

- [Class diagram](search-by-meaning-class.png) ([source](search-by-meaning-class.puml))
- [Sequence diagram](search-by-meaning-sequence.png) ([source](search-by-meaning-sequence.puml))
- Feature overview: [03-search](../03-search.png), [21-search-sequence](../21-search-sequence.png).

## See also

- [Keywords](../keywords/README.md): the other way, exact words in SQL.
- [Translations](../translations/README.md): the cards in another language.
- [Key passages](../key-passages/README.md): what the reader gets for the cards chosen.
- [Saved searches](../saved-searches/README.md): a search kept to run again.
- [Ingestion > Vectors](../../ingestion/vectors/README.md) and [Ingestion > Stories and threads](../../ingestion/stories-and-threads/README.md): where the vectors and the stories come from.
