# Search > Key passages

The reader ticks up to 10 cards (or facts of an affair) in the results and asks for their key passages.
Only then are pages read and the AI called. For each card the server reads up to 5 of its articles, shows
2 to 5 sentences of one of them word for word, as the article published them, with a marked machine
translation when it is in another language, counts how many of the texts were written apart from the
others, and quotes a named person who denies the news. The cards are shown as in the briefing.

## Where

- Client: `client/src/pages/Search.jsx` (`SearchPage.handleGenerate`),
  `client/src/features/search/components/feed-list/FeedList.jsx` (`handleSelect`, 10 at most),
  `client/src/features/search/components/summary-list/SummaryList.jsx` (the sheet "Key passages", each
  card a `BriefingCard`), `SearchApi.getNewsSummary` (`client/src/features/search/api/searchApi.js`).
- API: `POST /api/news/summary` (`NewsController.getNewsSummary`, `NewsService.summarizeStories` in
  `services/news-service.js`).

## How it works

- The page sends `{stories: [{urls}], language}`: each card with the urls of all its articles, its lead
  first. The controller wants 1 to 10 cards (`MAX_SELECTED_NEWS`), 1 to 30 urls each
  (`MAX_STORY_ARTICLES`), a language with sources; the same card twice is one. `{urls}` alone is still
  read, one card per url.
- `cachedArticles` refuses any url not in `articles` (400 "Unknown news: ..."): the API cannot be used to
  read or summarize any page of the web.
- `readingOrder` (`services/utils/reading-order.js`) keeps 5 articles a card (`READ_PER_STORY`), one per
  medium: a medium the reader trusts first (`FeedModel.trustedMedia`), else the lead, then the newest.
- A card whose every article is known only through Google News gets their real address from Google
  (`decodeLinks`, 2 a card, 10 at most, saved with `saveResolvedLinks`); a Google link not decoded is not read.
- `Crawlers.Html` reads every page at once: a plain fetch and Readability, Crawlee for the pages it missed.
- For each card, 5 cards at a time (`AI_CONCURRENCY`), the first article with 60 words at least
  (`canSummarize`) gives the passages:
  - kept already (`articles.extract`) and translated for this language: nothing asked;
  - kept, another language: `translationFor` only, saved with `saveTranslation`;
  - never read: `extractArticle` (`services/utils/extract.js`). The page is cut into numbered sentences
    (12 000 characters, 80 sentences, 4 to 90 words each, headings and captions out, quotes marked); one
    `ollamaJson` call (gemma4:31b, Gemini when Ollama fails) answers the numbers of 2 to 5 sentences,
    the topic and the sourcing (`named`, `anonymous`, `none`). The code keeps them while they fit 170
    words and sets them back in the order of the article; following sentences make one passage. Saved
    with `saveExtract` (`extract`, `summary`, `topic`, `sourcing`): a news asked twice costs nothing.
  - The translation (`translatePassages`) is asked sentence by sentence and checked: a figure lost or a
    count of sentences that differs is asked once more, then left out, the reader gets the original only.
- At the same time `contestedOf` (`services/utils/contested.js`) looks among the sentences of the texts
  read for a verb of denial in their language (25 at most), and one AI call says who denies what; shown
  only when someone named denies the news itself, about themselves, 2 deniers at most, translated.
- The titles of the leads in another language are translated (`translateNews`, see
  [Translations](../translations/README.md)). `corroborationOf` (`services/utils/corroboration.js`, no AI)
  compares the texts read on their sequences of 8 words: two are the same copy when half of the shorter
  is found in the other; it answers `{media, read, independent, agencies}` (AFP, Reuters, AP...).
- The answer, per card: `{id, summary, translation, titleTranslation, topic, sourcing, contested,
  summaryError, corroboration, articles}`. `summaryError` says why a card has no passages: the AI failed,
  only Google News knows it and gave no address, or no article could be read in full (a paywall, a
  protected site, its first lines only). The page says "N / M news read."

## Measured

From the code comments, [the former README](../../archive/readme-features-2026-10-24.md) and the decision log:

- Summaries written by the AI changed what the article says in 4 of 30 articles, 3 of them again in a
  second run; hence sentences shown word for word, never written by the AI (28.09.2026).
- Pages read: 85% of articles readable with 60 words or more, 96% of stories have one (`bench/readable.mjs`, 28.09.2026).
- Denials (`bench/contested-versions.mjs`, 05.10.2026): on 100 stories of politics and world news and 97
  briefing cards, 22 cards would carry one, 21 right; about 300 tokens a card.

## Diagrams

- [Class diagram](search-key-passages-class.png) ([source](search-key-passages-class.puml))
- [Sequence diagram](search-key-passages-sequence.png) ([source](search-key-passages-sequence.puml))
- Feature overview: [03-search](../03-search.png), [21-search-sequence](../21-search-sequence.png).

## See also

- [Briefing > Key passages](../../briefing/key-passages/README.md): the same extract for the stories of the briefing.
- [Briefing > Denials](../../briefing/denials/README.md): `contestedOf` in the briefing.
- [Translations](../translations/README.md): titles and descriptions of the list.
- [Search by meaning](../search-by-meaning/README.md) and [Keywords](../keywords/README.md): the cards to choose from.
- [Sources > Trusted and thumbs](../../sources/trusted-and-thumbs/README.md): the media read first.
