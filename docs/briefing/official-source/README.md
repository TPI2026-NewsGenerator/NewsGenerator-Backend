# Briefing > Official source

Under "Official sources", in the margin of a card, the reader sees where a party of the news (a club, a
federation, a company, the person it is about) said it itself: a post on its own website or open account
("UEFA said it: ..."), or a statement of it that one of the card's articles quotes ("FPF said it, reported
by record.pt: ..."). Two at most, of different parties. Most cards have none: X and Instagram can't be
read, and the sites of most big clubs publish no feed.

## Where

- `client/src/features/briefing/components/BriefingCard.jsx`: `OfficialSource`, in the margin of the
  card, the sentence quoted with its machine translation when in another language.
- In the e-mail, a box right under the sentences of the card (`services/utils/briefing-mail.js`); the
  reader can take a line out in the mail bar (`MailAside.jsx`, `removed.official`).
- API: no route of its own. Written during `POST /api/briefing` (step `angles`), read with
  `GET /api/briefing` as `items[].official`.

## How it works

- In the step `angles` of `write()` (`services/briefing-service.js`), beside the other angles, the
  names and what the profile follows; `officialSourcesOf` (`services/utils/official-sources.js`) gets
  each card's title, its other titles, 700 characters of its passages, the date of its first news and its
  articles read. It never fails the briefing: an error leaves the cards without it.
- The parties: one call of the AI per card (`partiesPrompt`, gemma4:31b, Gemini when Ollama fails),
  3 cards at once. It tells the kind of news (claim, announced, event, analysis) and names up to 4
  parties (`MAX_PARTIES`) with what they are and their other names; none for an analysis.
- Their item of Wikidata (`itemsOf`): a name already decided is read from `party_names` (one without an
  item is searched again after 7 days); the others are searched under each of their names
  (`wikidata.searchItems`), 250 ms apart, 30 searches and 20 s per briefing at most, stopping at the first
  refusal. The AI picks the item among the answers (15 names a call); `saveNames` keeps the choice.
- Their channels (`readChannels`): site, X, Instagram, Facebook, YouTube, TikTok, Mastodon, Bluesky,
  Telegram, kept in `entities.channels` and read again after 30 days. Only the site, Mastodon and Bluesky
  are read: the news our feeds already read of the site's medium (`OfficialModel.newsOfMedia`, 300 newest
  per medium), the site's own feed (`entities.site_feed`, looked for apart by `findFeeds`, 45 s at most,
  for the next briefing; `''` when it has none, tried again after 7 days), the Mastodon RSS and the 60
  last posts of Bluesky (public API), 4 items at once.
- The candidates of a card (`candidatesOf`): the posts from 5 days before its first news
  (`BEFORE_DAYS`), naming another of its parties or sharing words with its titles, the most alike first,
  10 at most.
- Judged twice (`checkPrompt`), the second time in reverse order: a post counts only when both answers
  say "confirms" (`confirmedOf`), one per party.
- The statements (`services/utils/statements.js`), read meanwhile: the sentences of the card's articles
  with a word of a statement (English, French, Spanish, Portuguese, Italian, German, Dutch) ("statement", "communiqué", "comunicato", "Stellungnahme"...),
  never a sentence of the lead article that only retells its news (`retellsLead`), 25 at most; asked
  twice, the sentences reversed the second time; kept when both answers say the party itself said the
  card's own fact (`confirmingOf`).
- `withStatements`: the posts first, then the statements of the parties with no post, 2 at most
  (`MAX_OFFICIAL`). A statement in another language than the reader's is translated, and since 18.10.2026 the
  title of a post too (its language told by its title, `languageOf`), shown in place of it in the e-mail; a post read through
  Google News gets the address of the site (`withSiteLinks`, saved with `saveResolvedLinks`). The party is
  named as its item says it (`partyName`: its acronym, else the AI's name, else the English label).
- Left out on purpose: YouTube (a title, no statement) and a denial by a party (see the measures).

## Measured

From the comments of `official-sources.js` and `statements.js`:

- 163 cards of four readers over 7 days (`bench/official-badge.mjs`, judged by hand): 19 cards got a
  right official post, none a wrong one, 5 of them debatable. YouTube: its 2 "confirms" both wrong.
  Denials: 5 found over three runs, all wrong. One answer of the AI was not stable (the same posts
  "confirms" then "denies"), hence the two answers.
- A statement reported by an article that a denial of the card quotes too (the same sentence of the same
  article, "AFC denies" and "Asian Football Confederation said it") is shown once, in "Contested"
  (`withoutDenied`, `contested.js`, 28.10.2026, an idea of the user). Only for the briefings written since.
- The statements reported by the articles (`bench/official-embeds.mjs`): 24 cards, 20 right, 17 of them
  without an official post. The posts the media embed were none the parties' own (27 posts on 15 cards).
  Leaving out the lead retelling its news (`bench/official-statements.mjs`): 19 cards with a statement
  -> 17, AI calls 82 -> 70.
- Searching a party under its English and short names too: of 357 parties, 75 not found under the
  card's name alone, 24 of them found that way, 4 cards more confirmed.
- The first try took 45 to 310 s on four briefings, 102 s of 134 in the searches; hence the budget of 30
  searches and 20 s, and the site's feed looked for apart: the news our feeds already read of the sites
  gave 31 of the 42 confirming posts.
- `partyName`, 174 names (`bench/official-party-names.mjs`, 14.10.2026): the AI's name kept 111 times,
  the 63 others all right.
- Of the 18 briefings of 12-14.10.2026, 8 of the 9 posts shown were links of Google News, decoded in 2 s.

## Diagrams

- [Class diagram](briefing-official-source-class.png) ([source](briefing-official-source-class.puml))
- [Sequence diagram](briefing-official-source-sequence.png) ([source](briefing-official-source-sequence.puml))
- The briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Denials](../denials/README.md): someone named who denies the news, read the same way
- [Other angles](../other-angles/README.md): the other part of the step `angles`
- [Analysis (IA)](../analysis-ia/README.md): cites the official sources (`O1`)
- [Email](../email/README.md): the box of the official sources in the e-mail
- [Following > Wikidata items](../../following/wikidata-items/README.md): the `entities` table
- [Sources > Discovery](../../sources/discovery/README.md): `findFeeds`
