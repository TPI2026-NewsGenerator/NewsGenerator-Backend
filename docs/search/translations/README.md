# Search > Translations

A search reads the news of every language and shows its cards in the one the reader chose. The title and
the description of a card written in another language are translated by the AI when the card comes near
the screen, a few cards in one request, and marked as a machine translation; the title as written stays
under it. The facts of an affair under a card get their title translated the same way.

## Where

- Client: `client/src/features/search/translation.js` (`createTranslator`, `useTranslation`,
  `TranslationContext`), used by `client/src/features/search/components/article/Article.jsx` (title and
  description) and `client/src/features/search/components/thread-timeline/ThreadTimeline.jsx` (title
  only); one translator per search in `client/src/pages/Search.jsx`, kept with the search for a day
  (`client/src/features/search/keptSearch.js`). `SearchApi.translateNews` in `client/src/features/search/api/searchApi.js`.
- API: `POST /api/news/translations` (`NewsController.translateNews`, `NewsService.translateNews` in
  `services/news-service.js`).

## How it works

- Each card in a language other than the one searched watches its place with an `IntersectionObserver`,
  600 px ahead of the screen (`AHEAD`). The cards reached within 150 ms (`WAIT_MS`) are sent together, 30
  cards (`news`, title and description) and 60 titles (`titles`, the facts) a request at most; the rest
  goes in the next request.
- The controller wants two lists of strings, 30 and 60 at most and one url at least, and a language with
  sources (400 otherwise). Only news of the cache are translated: `cachedArticles` refuses any other url
  (400), so the AI is no translator for any text.
- The language of each news: `articles.lang`, told when it got its vectors, else read from its title and
  description (`languageOf`, `services/utils/language.js`). A news already in the language asked, or in a
  language the AI is not told (`writtenIn` gives null), is skipped. The description is cut at 400
  characters, as on the card.
- The texts not translated yet for this language go to `translateTexts` (`services/utils/extract.js`), 20
  a call (`TEXTS_PER_CALL`), 5 calls at once: one `ollamaJson` call (gemma4:31b, Gemini when Ollama
  fails) for texts of several languages, each marked with its language. A wrong number of answers is asked
  once more, then every text of the call gets none. A translation that loses a figure of its text
  (`keepsFigures`: "1,000" and "1 000", "7 p.m." and "19h00" are the same figure) is dropped.
- A call where every text got none (the AI down or busy) is not kept: its texts are asked again by the next
  search that shows them (until 17.10.2026 they stayed untranslated until a restart). A text that got none
  beside others (a figure lost) is kept as none.
- The answers are kept in the memory of the process, per language and text, 20 000 at most
  (`MAX_KEPT_TRANSLATIONS`, the oldest dropped first), and lost at a restart: a text is translated once per
  language, whatever the search showing it.
- The answer `{translations: [{url, language, title, description}]}` holds only the news with a
  translation. The client keeps null for the others and never asks them again in that search.
- The key passages of a card have their own translation, sentence by sentence (see
  [Key passages](../key-passages/README.md)); the titles of the cards chosen there go through
  `translateNews` too.

## Measured

- DeepL against the AI translation (decision log, `bench/translation-deepl.mjs`, 16.10.2026): 310 foreign
  texts of 7 briefings judged blind, meaning errors 2.3% for the AI (gemma4:31b as shown) against 9% for
  DeepL; DeepL rejected.

## Diagrams

- [Class diagram](search-translations-class.png) ([source](search-translations-class.puml))
- [Sequence diagram](search-translations-sequence.png) ([source](search-translations-sequence.puml))
- Feature overview: [03-search](../03-search.png), [21-search-sequence](../21-search-sequence.png).

## See also

- [Search by meaning](../search-by-meaning/README.md) and [Keywords](../keywords/README.md): the cards of every language.
- [Key passages](../key-passages/README.md): the translation of the passages.
- [Briefing > Key passages](../../briefing/key-passages/README.md): the same checks in the briefing.
