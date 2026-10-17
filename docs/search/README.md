# Search

The Search page answers a question the reader writes, from the news the server already holds (30
days, every language, the sources of every reader), without fetching any feed. A sentence is searched by
its meaning, with the AI judging the candidates and Google News asked too; words with a quote, a comma
or a `-word` are searched exactly, in SQL. The cards come grouped by story and by affair, translated into
the reader's language as they come near the screen. Only the cards the reader picks (10 at most) are
read and get their key passages. A search can be saved and filled again.

## Overview diagrams

- [03-search](03-search.png) ([source](03-search.puml)): every module of the feature.
- [21-search-sequence](21-search-sequence.png) ([source](21-search-sequence.puml)): the cards, then the
  key passages of the ones chosen.

## Sub-features

- [Search by meaning](search-by-meaning/README.md): a sentence, its bge-m3 vectors, the verdicts of the
  AI (answers, then close ones), Google News when our sources answer little.
- [Keywords](keywords/README.md): Google-like operators turned into Postgres regexes on a pg_trgm index,
  accents ignored, the wider search offered under 5 news.
- [Key passages](key-passages/README.md): `POST /news/summary` on the cards chosen: 5 articles read,
  sentences shown word for word, how many different texts, denials, translation.
- [Translations](translations/README.md): `POST /news/translations`, the titles and descriptions of the
  cards in another language, figures checked.
- [Saved searches](saved-searches/README.md): the form kept under a title, replaced or deleted.
