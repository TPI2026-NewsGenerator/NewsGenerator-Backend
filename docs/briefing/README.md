# Briefing

The briefing is the page a reader opens once or twice a day: 10, 20 or 30 cards of the news of the last 1 to 7 days
closest to their profile, chosen by the AI, each told in the article's own sentences and translated into the
reader's language. A card says why it was chosen, who tells it and how many media wrote it themselves, who denies
it, its other angles and the posts where a party of the news said it itself; the reader gives it a thumb, ticks it
for an e-mail, or adds a news of their own by its link. Once the cards are shown, an AI analysis is written for the
cards that merit one.

It is written in background (`services/briefing-service.js`, `write`): `POST /briefing {hours, size}` answers 202
with the briefing `running`, the client (`client/src/pages/Briefing.jsx`) asks `GET /briefing` every 3 s until it
is `ready` or `failed`, one at a time per profile, one still running after 30 minutes marked failed. Each step is
saved in `briefings.step` and shown on the page while it runs:

1. **ranking**: the sources found for the profile that bring nothing are pruned and the thumbs read; the stories of
   the window, in every language, of every shared feed, every reader's sources (but the ones the reader removed from
   this profile, `removed_sources`) and the Google News searches of the interests, are scored in SQL on the interests' vectors (`rank_profile_stories`, dense + 0.5 × sparse); 600
   ranked for 10 cards, each interest its share; the stories sent by e-mail in the last 48 h left out unless they
   evolved; 40 candidates of feeds, 10 of Google News only, 10 of a trusted medium.
2. **choosing**: the AI (`selectStories`, gemma4:31b) reads the candidates against the whole profile and its
   projects, with the thumbs as examples, and chooses more stories than cards (`chosenFor`: 20 for 10 cards, 30
   for 20, 45 for 30); each interest gets its share
   (`balanceSelection`), the rest waits as a reserve. The sentence a card shows under its title (`why`) is written
   here, from the title and the description only, before the article is read: it keeps an acronym as written unless
   they spell it out (since 23.10.2026, `ACRONYM_RULE` in `services/utils/profile-ai.js`). The AI spelled "FMF" out
   from what it knew ("Mexican Football Federation (FMF)" for a Malagasy federation, "Madagascar Football
   Federation" for a Moldovan one): of 16 stories whose why had spelled one out in 30 days (23 times in 1 357
   cards), 5 runs of the prompt spelled one out in 34 whys of 50, 19 of them without their sources doing it, and
   in 5 of 50 with the rule (`bench/why-acronym`).
3. **checking**: two calls together, the articles of each story that tell its news (`checkStories`) and the cards
   of one news joined (`mergeStories`), with the versions of a card in the reader's language (from 0.75) and in
   other languages (from 0.78). The AI failing, the stories stay as the vectors grouped them.
4. **reading**: up to 5 articles a story, a trusted medium first, else one in the reader's language, then one per
   medium; the real address of a news of Google News only when no feed lets read the story (10 a briefing).
5. **summarizing**: for each story, 5 at once, two calls together on the first article read in full: its
   [key passages](key-passages/README.md) with the [summary](summary/README.md) and the
   [bullet points](bullet-points/README.md) of the same sentences, translated; and the [denials](denials/README.md)
   its articles report. Then a cut title is taken whole from its
   page, the cards are read again with their passages to leave out the ones on what the reader refuses
   (`reviewCards`), and the titles in another language are translated. A card that can't be read takes the next
   story of the reserve, 2 more rounds at most (`readable-cards.js`).
6. **angles**: five parts together, none of which can fail the briefing: the [other angles](other-angles/README.md),
   the [official sources](official-source/README.md), the news of what the profile follows, the names shown
   on each card, and the AI version of the points and summary of the cards kept (asked of every story read until
   17.10.2026, the ones unreadable or left out by `reviewCards` too). Then the illustration of each card
   (`illustrationsOf`, since 18.10.2026): the picture Wikimedia Commons has of the person, else the
   organisation, its names are, used as its picture only when none of its articles gives one.

The picture of a card (`pictureOf`) is the one its article's page gives to be shared (`og:image`) first, the one
its feed gave after (since 18.10.2026: often a thumbnail); a site's picture for pages without one is never taken.
Since 29.10.2026 the sizes of the pictures of all its articles are read (`sizesOf`, `picture-sizes.js`: the first
bytes of each file, 8 at a time, 25 s at most for the briefing) and the card takes the first sharp one (560 px wide
or more) in the order of its articles, lead first; a picture that does not load is left out, one on http comes
last (the page is on https, its browser blocks it), and when none is sharp the widest is taken. The card keeps
all that load (`pictures`) for the e-mail. Without any, its illustration, captioned "Illustration" and credited to its author and licence (see
[e-mail](email/README.md)).

Then the cards are saved (`briefings.items`, status `ready`), and the [analysis](analysis-ia/README.md) starts,
not awaited (`briefings.analysis`, the client asking every 8 s while it runs).

A card shows **one way of reading at a time**, chosen by the reader with "Read as" (`BriefingFormat.jsx`,
`formats.js`) and kept in the browser (`localStorage`): Key passages (the default), Summary or Bullet points, all
three made of the article's own sentences. The AI version of a Summary or of Bullet points is an extra, shown on
demand ("Show AI version") under them. The e-mail has its own choice of way (`format` of
`POST /briefing/:id/email`), and the cards whose AI version the reader ticked (`ai`).

## Overview diagrams

- [08-briefing](08-briefing.png) ([source](08-briefing.puml)): the stories ranked, chosen and checked for a profile
- [08b-briefing-cards](08b-briefing-cards.png) ([source](08b-briefing-cards.puml)): the cards, the articles read,
  their passages, what is around them, and the analysis
- [22-briefing-sequence](22-briefing-sequence.png) ([source](22-briefing-sequence.puml)): written in background in
  six steps, followed by the client, then its analysis

## Sub-features

How a card reads:
- [Key passages](key-passages/README.md): the AI gives sentence numbers, the code shows them word for word, 170
  words at most, a translation checked for its figures
- [Summary](summary/README.md): the most important published sentences within 65 words, one paragraph
  - [Summary (IA)](summary/summary-ia/README.md): a summary written by deepseek-v4-pro, shown on demand, left
    out when it holds a figure the article does not
- [Bullet points](bullet-points/README.md): the 3 most important published sentences, one per point
  - [Bullet points (IA)](bullet-points/bullet-points-ia/README.md): 3 or 4 points written by deepseek-v4-pro,
    shown on demand, figures checked

What a card adds:
- [Analysis (IA)](analysis-ia/README.md): why it matters, what could come next and the story so far, for the
  cards that merit one, written after the briefing
- [Official source](official-source/README.md): where a party of the news said it itself
- [Corroboration](corroboration/README.md): how widely a news is carried and how its article credits its sources, shown on the card
- [Other angles](other-angles/README.md): news of the same affair that tell something the card does not
- [Denials](denials/README.md): "Contested", someone named who denies the news, quoted

What the reader does with it:
- [Thumbs](thumbs/README.md): "Good for me" / "Not for me", read by the next briefings
- [News by link](news-by-link/README.md): a news of their own added to the briefing as a card
- [Email](email/README.md): the cards ticked sent by e-mail, in the way chosen

## See also

- [Profile](../profile/README.md): the interests the briefing ranks on
- [Ingestion](../ingestion/README.md): the stories it reads, built in background
- [Following](../following/README.md): the news of what the profile follows, beside the cards
- [the former README](../archive/readme-features-2026-10-24.md), "The briefing" and "Key passages"
