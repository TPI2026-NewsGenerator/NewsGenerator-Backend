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
   evolved; 40 candidates of feeds, 10 of Google News only, 10 of a trusted medium; then the candidates whose news
   the media had told before the window and only tell again in it are left out ([News told before the window](#news-told-before-the-window)).
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
   other languages (from 0.78). The AI failing, the stories stay as the vectors grouped them. A story of another
   language the check kept joins its card only if the question of the same FACT agrees too (`agreedVersions` of
   `foreign-versions.js`, a call of `mergeStories` listing the cards that have such versions, then the versions): the
   check keeps the reactions and the other statements on one event, "when in doubt keep", and joined to the card of the
   comment of the head of the referees on a goal the news of the outburst of a coach after the same match (briefing of
   Roberto 657, 10.11.2026), 6 of its 9 media being that other news. A story joined by mistake hides a news, a story not
   joined stays a story of its own (a card, an angle, or folded into a card, see "Two cards of one news"). The AI
   failing joins none; `AI_STRICT_VERSIONS=off` keeps what the check kept. Measured on the 1 177 stories joined to the
   cards of the last 80 briefings (the question agreed with 771, disagreed with 406), 70 of them rated blind by two raters (94 %
   agreement): the question kept 32 of the 35 that were the same news and left out 23 of the 35 that were another fact of the same
   affair; extrapolated, the joins held 68 % of the same news before, 91 % now, and 12 % of the true joins are lost (93 of 798;
   a sample of 70: the margins are some 8 points). The cases are in the live corpus (`samefact`, `bench/regression-run.mjs`).
4. **reading**: up to 5 articles a story, a trusted medium first, else one in the reader's language, then one per
   medium; the real address of a news of Google News only when no feed lets read the story (10 a briefing).
5. **summarizing**: for each story, 5 at once, two calls together on the first article read in full: its
   [key passages](key-passages/README.md) with the [summary](summary/README.md) and the
   [bullet points](bullet-points/README.md) of the same sentences, translated; and the [denials](denials/README.md)
   its articles report. Then a cut title is taken whole from its
   page, the titles lose the bait of their medium ([neutral titles](#neutral-titles)), the cards are read
   again with their passages to leave out the ones on what the reader refuses
   (`reviewCards`), the titles of the cards kept with a judgment inside their sentences are rewritten by the AI when a
   second opinion says they tell the same fact ([neutral by default](#neutral-by-default-evaluate-rewrite-verify)),
   and the titles in another language are translated. A card that can't be read takes the next
   story of the reserve, 2 more rounds at most (`readable-cards.js`).
   A glossary told to the translation of a card (`glossariesOfStories`, `card-spellings.js`) has no acronym written in Latin letters: the translation keeps it as
   written. The tagger links a name by its text alone, so "LNFP" of the card of the Moroccan federation was the league of Honduras, and its title
   said "the role of the Liga Nacional de Fútbol de Honduras" (briefing 656 of Enzo, 10.11.2026; the check of the names took the link away
   afterwards, too late for the words). For a link that gets there and that the check then refuses, `withoutUntrustedLabels` puts the written name back in
   the translated texts of the card, unless the article itself has the label.
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
or more) in the order of its articles, lead first; a picture that does not load (an address that is gone, a page, a format unknown) is left out,
but not one the check was only refused (401, 403, 429, a challenge of Cloudflare: the CDN of tribuna.com answered a script so for a picture a browser
loads, a card of the briefing of Enzo of 9.11.2026 lost its only one): its size is not known, the browser of the reader loads it or the card hides
it. One on http comes
last (the page is on https, its browser blocks it), and when none is sharp the widest is taken. The card keeps
all that load (`pictures`) for the e-mail. Without any, its illustration, captioned "Illustration" and credited to its author and licence (see
[e-mail](email/README.md)).

**The picture chosen by the AI** (`choosePictures` of `picture-choice.js`, since 10.11.2026, at the end of `write()` with the other readings of the cards).
The width says nothing of a blur, a logo or a picture of another subject (the user: two cards of the briefing of Enzo had "de très très mauvaise
qualité", better pictures were among those of their articles). gemma4:31b, which reads pictures, is shown those of a card (the one shown and three
others at most, wide enough, on https, as the files are: JPEG, PNG or WebP of 3 MB at most, fetched as the app is, never as a browser) with its title,
the letters turned by story so that the one shown is not always the "A". It gives each a quality (1-5) and a relevance (0-2) and names the best; the code
decides: the card keeps its picture unless the AI gives the other a quality at least one point above (the relevance of a picture counts for 3 points when
it has none; a picture shown with a relevance of 0 against one that has some is replaced). A picture that does not load, or an AI that does not answer
(`AI_PICTURES=off` switches it off, `PICTURE_MODEL` names another model that reads pictures), leaves the card as it is. The change is in the log
(`Briefing 512: pictures: the picture of "…" changed (quality 3 -> 5, …)`), on the card (`pictureChosen`) and in `scripts/briefing-audit.js`.
About 1 100 tokens a card, 10 s for the 11 cards of a briefing of 20 that have another picture.

Measured on 60 cards and their 198 pictures (the first four of each, from the benches and the last 80 briefings), rated blind by two raters (quality and
relevance; they agree at 0.75 on the quality, on the best picture for 46 cards of 60): the first sharp picture of the articles 3.98 of quality
(5 pictures of 60 rated 2.5 or less); bytes per pixel 3.93 (no better); a Laplacian measure of sharpness 4.07, but it chose pictures of another subject
(relevance 1.63 against 1.70) and needs an image library; the AI, its best choice always 4.12; the AI with the margin of one point 4.17, none of its
changes breaking a card, 9 to 11 cards of 60 changed, the same on two runs. The margin was chosen after seeing the data: the gain is probably a little
overestimated. The raters did not find the picture of the card 1 of that briefing poor (all four candidates 4 of 5), which the AI keeps too: it is the
card of the pictures a reader sees larger than the raters did. `bench/picture-choice-live.mjs` runs it live on a briefing never saved.

Then the cards are saved (`briefings.items`, status `ready`), and the [analysis](analysis-ia/README.md) starts,
not awaited (`briefings.analysis`, the client asking every 8 s while it runs).

A card shows **one way of reading at a time**, chosen by the reader with "Read as" (`BriefingFormat.jsx`,
`formats.js`) and kept in the browser (`localStorage`): Key passages (the default), Summary or Bullet points, all
three made of the article's own sentences. The AI version of a Summary or of Bullet points is a switch ("AI version") over the sentences: on, it is
shown **in place of** the article's own sentences, not under them (the user, 9.11.2026), and the switch puts them back (the original of a
translation stays one click away under it). The e-mail has its own choice of way (`format` of
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
- [The affair](affair/README.md): the events of the affair behind a card on a horizontal line, and how widely the media told it
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

## The audit after every briefing

The cards of a briefing are checked **by the server itself** once written (`logBriefingChecks` of `services/utils/briefing-checks.js`, called
at the end of `write()`, 9.11.2026: the reader and his friends were the first to see what a check finds). No AI, nothing is changed, a failure
never fails the briefing: one line in the log, `Briefing 512: audit: all the checks of the cards hold (30 cards)`, or on the error output
`Briefing 512: audit: 2 checks of the cards fail: no key point begins with a dateline (3: WALVIS BAY – …); every card has a picture (1: …)`.
The checks (`cardChecks`): the title, the text, the key points and the digest of a card in another language are translated; no text a reader
sees is written in another language than theirs, read from its letters (not from the label of its feed); no sentence of a translation is left
in the language of the article; every card has a picture; no key point begins with a dateline or is the caption of a photo; no title keeps the
label of a paywall; no name is spelled with other accents than its card; no angle has a language its title does not say; no other sentence a reader
sees (the line of the choice, the AI version, a denial, a statement, the card it follows) and no name (a chip) is written in the letters of another
language than theirs. `scripts/briefing-audit.js`
runs the same checks on a briefing already written (by its id, or a file of cards never saved), adds the ones of the analysis, written after the
cards, the share of the cards with their names, countries, angles and picture against the last briefings of the profile, and why a card has no
country, then what the AI readings of the cards did (the pieces the proofreading took out, the names with no item left out as no names), so that each
is read and, if the rules did not know it, becomes a case. A line of the log that fails is a case for the corpus of `tests/regression`, then a rule of the code.

## The proofreading before the reader

The same problems came back since the start of the project (a translation not done, a word nobody wants in a title or in the key points): every
rule written for one of them left the next one. So the cards are read once more by the AI, **at the end of `write()`, before the audit**
(`proofreadCards` of `services/utils/proofread.js`, 9.11.2026, the user: "une relecture pour éviter tout ça"). `AI_PROOFREAD=off` switches it off.

- **The AI only points.** gemma4:31b is given the title and the first three paragraphs of each way of reading a card (key passages, bullet points,
  summary) as the reader sees them, 20 cards a call, and answers the pieces that are not the article's own words, copied as written, with their
  kind: dateline, credit, label, caption, foreign, junk. A card of the reader's language and a translated one are read the same way.
- **The code decides** (`cutPiece`): a piece is taken out only when it is short (16 words, 8 in a title), copied as written at the start or at
  the end of a sentence, set apart from it by a mark (`:` `–` `|` `)` `]`...), what follows it is the start of a sentence (not a lower case word:
  "As Gazzetta dello Sport reports, the…" is the sentence, "AAP understands…" is the news), and enough is left (3 words of a title, 6 of a
  paragraph). Moreover: a dateline only opens the first paragraph (a date and a dash further on open a line of a timeline); the place and the date
  of a photo caption are not taken off its words (what is left would pass for a sentence of the article); a label that tells what the text is
  (OPINION, Exclusive, Live...) or is no format of the page (the competition "Ligue 1:" the AI called a label) stays; a text in another language is
  taken out as a whole paragraph only when its letters say it is (`shownLanguage`) and other paragraphs are left. A caption and a piece the code
  does not accept are **only reported**. A piece verified in one way of reading is taken out of the others where it stands at the edge too: they
  are made of the same sentences.
- **What it did is written down**: in the log (`Briefing 512: proofread: took out "VIDEO:" (label, title) of the card "…"`, and `left` for what it
  did not take out and why) and on the card (`proofread: [{kind, text, fields}]`, shown by `scripts/briefing-audit.js`). Each piece it took out or
  left that the rules did not know is a case for the corpus (family `proofread`), then a rule of the code, so that the next briefing does not need
  the AI for it.
- **It never fails and never waits long**: the AI not answering, answering what cannot be read, or taking more than 90 s leaves the cards as they
  are (one more try for a call that fails).

**Measured** (`bench/proofread.mjs`, `bench/proofread-live.mjs`, 9.11.2026). 480 cards: 240 real ones of the briefings of 14 days (44 with a defect the
code knows), 140 where 7 kinds of defect were put in, 100 clean ones. The flags the code would accept, judged against the known defects, and the 29
that no known defect explained judged blind by two readers (27 of 29 agree):

| | gemma4:31b | deepseek-v4-pro, thinking off | deepseek-v4-pro, thinking on |
|---|---|---|---|
| defects found (of 193) | 191 | 190 | 193 |
| defects the code did not know, found and real | 20 | 13 | 22 |
| false alarms | 0 | 0 | 4 |
| time for the 480 cards | 71 s | 81 s | 1645 s |
| tokens written | 17 000 | 18 000 | 228 000 |

gemma4:31b is the model of the step: as good as the others on what it finds, no false alarm, 23 times faster than the model that reasons, which
finds two more but takes out the source of a news (4 attribution clauses, "As Gazzetta dello Sport reports,"). The defects the rules did not know,
13 real ones in 340 clean real cards (about 4 %): `VIDEO`, `(pic)`, `(Video)` and `Thursday briefing:` before or after a title, `by Paolo
Moramarco` or `writes IAN LADYMAN` after one, `| Yalla Shoot`, `GENEVA --`, `Conakry –`, `NAIROBI, Kenya, November 4, 2026 –`.

The production step itself (the three ways, the checks of the code): on the 229 cards of the 20 briefings saved for Enzo, 12 calls, 13 s, 87 000
tokens read, 5 000 written; it took out 7 pieces, all 7 real defects (`ZURICH:` twice, `MBABANE –`, `WALVIS BAY –`, `October 14 –`, `| YSscores`,
`[premium]`), and left 44 (captions already cleaned, a competition, an opinion, quotes in another language). On the same cards with 10 defects
put in (220 cards): 220 taken out and the text restored. Found on the way: the AI copies the field as it reads it ("passages 1"), not as it was
asked ("passages"): the first version of the step lost most of the datelines of the text to it (0 of 6 for three kinds), which only a run against
the real AI shows and a test with a mocked one does not.

## Two cards of one news

The same news sometimes stood on two cards of one briefing (the user, 9.11.2026: "des fois la même histoire est présentée sur 2 cartes
différentes"). The merge of the stories before the cards are read (`keepSameNews`, "in doubt, null") misses some, and a pairwise variant joined
other developments of the same affair (decision log, 3.11.2026). Measured on 864 cards of 40 saved briefings (`bench/duplicate-cards.mjs`, pairs
judged by two readers blind to the models, 66 pairs): **18 true pairs in 12 briefings (30 %)**; "Official: Galliani backed by Players and Coaches"
and "FIGC Presidency: Italian football on the brink of a major shift", two cards of Liga MX with the same title, two cards on the access to the FFE
documents.

Once the cards are written, `sameNewsGroups` of `services/utils/card-merge.js` gives the whole briefing (the title, the media, the names and the
first 50 words of each card) to **two readers at once**, gemma4:31b and deepseek-v4-pro with reasoning (no other model to fall back to: a vote of
gemma with itself is no vote), and asks which cards tell the same news. They answer while the words of the cards are translated and proofread.
Only the pairs **both** give are kept (and a group of three only when every card is paired with every other one by both):

| the pairs given | true (of 18) | a development of the same affair |
|---|---|---|
| gemma alone | 14 | 11 of 27 |
| deepseek with reasoning alone | 16 | 3 of 19 |
| both | 14 | 1 of 15 |

A second look pair by pair, with the definitions the judges had, accepted only 3 to 6 of the 18 true pairs with three models (each small
detail made a difference): not used.

**The second card is not removed, it becomes an angle of the other** (`foldCards`): the card best covered keeps its content and takes the place of the
first of them; the other is put first among its angles (`angles[].folded`, its title as the reader saw it, its translation, its link, its media),
its articles and its media are counted with the card's, its story is among the `mergedStoryIds` (it is not offered again as new), and the card says
`joinedCards`. A pair that was a development, not one news, is then one click away where a development belongs: **no news is hidden by a wrong
decision**. Each fold is written in the log (`Briefing 512: same news: "…" is among the angles of "…" (both readers agree)`). A reader that
fails, answers what cannot be read or takes more than 130 s leaves the cards as they are; `AI_CARD_MERGE=off` switches it off. The step adds
about 40 s to a briefing (the reasoning reader, 4 700 tokens written).

Run for real, twice, on the same 40 briefings (`bench/duplicate-live.mjs`, the readers do not answer the same twice): 15 and 16 pairs agreed,
13 true each time (of 18), the others developments of one affair or pairs the judges split on (1 development and 1 pair not judged the first
time, 2 developments and 1 split the second); 12 and 14 briefings lose a card (864 → 849 and 848 cards), 500 to 600 s for the 40 at 3 at a time.
So between 1 in 15 and 3 in 16 of the pairs folded are not one news, which is why they are folded among the angles and not removed. Limits: only the
pairs a model grouped or with similar title words were judged, a duplicate with unlike titles no reader proposed was not seen; 66 pairs, 18 of
them true.

## Neutral titles

A card shows its title without the bait of its medium ("Information incroyable !", "Bomba zilei!", "Êtes-vous d'accord
avec lui ?") when it has some (the user, 03.11.2026). The AI is asked once for all the titles (`neutralTitles`,
`services/utils/neutral-titles.js`) which teaser each one starts or ends with, copied as it is; it never rewrites.
The code takes a teaser out only when it is a whole sentence apart from the rest by its punctuation, at most 6 words,
with no figure, no negation, no acronym nor capitalized name (the fact of the title), not in a quotation and not
a word of status ("Official"); and leaves the title as it was when fewer than 3 words or less than half remain. It
also takes out the exclamation mark at the end of a title and turns the ones between two sentences into full stops
(not in a quotation, not "Yahoo!"). The label of access of a medium goes too, with no AI (`withoutAccessLabel`,
9.11.2026): "[premium]", "(S+)", "(+)", "[Abo]", "(réservé aux abonnés)" at an end of the title, "PREMIUM | " before it; not "Disney+"
nor a word of the sentence ("plus"). The title as published stays in `item.titleAsPublished`: the card says "Title
shortened" and shows it on demand, as the original of a translated title.

Measured on 320 titles of the cards of 14 days (`bench/neutral-titles.mjs`): taking out any passage the model found
(adjectives, verbs) changed half of them and broke or emptied many ("Real Madrid's 'Negreira bubble' believes
Barcelona will fall" -> "Real Madrid's believes...", "l'affaire du but fantôme" -> "l'affaire du but"); whole
teasers only, about 1 title in 20 changes, almost all right, one label lost ("¡Habla el árbitro!:"). A call of the AI of
about 1 300 tokens for 40 titles; if it fails, the titles stay as they are.

### A neutral title on demand

The judgment is also inside the sentences ("a shameful decision"), where the removal above cannot reach it without
breaking the title. In the editor of the e-mail a button "Suggest a neutral title" asks the AI for a rewrite of the
title the reader sees (`POST /api/briefing/:id/stories/:storyId/neutral-title`, `BriefingService.neutralTitle`,
`rewrittenTitle` in `neutral-titles.js`; the administrators, 120 an hour). The proposal is shown against the title,
word by word (what is taken out struck, what is put in underlined); the reader uses it, which puts it in the title
field, or keeps the title (the user, 03.11.2026: "the AI proposes, the reader validates"). Nothing is changed without
being read, because free rewriting changed the meaning of about 1 title in 10 (12.10.2026) and still does: "SFV reacts
to Embolo case" became "SFV announces new guidelines" without thinking.

The AI gets the title, 1 500 characters of the sentences of the card, and the language to write in (the reader's when
the title was translated). The code refuses a proposal, and shows none ("changed what the title says"), that keeps an
exclamation mark; adds a figure or a name the title and the sentences do not have; loses a figure, a name (a word that
begins like it counts: Barca, Barcelona) or a quotation of the title (its punctuation aside); adds or loses a
negation; turns a question into a statement; is more than two words longer than the title or keeps less than 40% of
it. A title in capitals or in title case ("Friendship Allstar Crowned EBFA Champions") is checked for acronyms only.
`{title: null, reason: 'same'}` says the title is neutral already.

Measured on 45 real titles, half with a mark of the medium (`bench/neutral-rewrite.mjs`, the same sample each run):
with thinking off 19 proposed, 12 neutral already, 14 refused by the checks (before they were loosened: a quotation
closing the title, the first word after a "!", titles in title case); with thinking on it stays closer to the title
(it keeps "in the VAR" in "Scandal in the VAR! Presence of outside people denounced...") and, with the checks as they
are now, 22 proposed, 18 neutral already, 5 refused (a quotation without its "huge", "Nobody wants" made "Lack of
candidates", a name dropped with its teaser). Thinking is on: it costs about 1.7k tokens a title instead of 25, for
one title asked for by a click. Some proposals still drift in meaning ("UEFA raids FSS!" -> "UEFA intervenes in FSS"):
that is what the reader reads it against the title for.

### Neutral by default: evaluate, rewrite, verify

The user asked (03.11.2026) whether the AI could judge first whether a title needs changing, and whether neutral
titles could be the default in every briefing; measured, then built the same day (`aiRewrittenTitles` in
`neutral-titles.js`, called by `read()` of `briefing-service.js` after the check of the cards, so only the cards kept are
rewritten; `AI_NEUTRAL_TITLES=off` turns it off). The teaser removal above still runs first. The card says "Title
rewritten by the AI" with a note and a button "Show the title as published", apart from the "Show original" of a
translation (which shows the title of the card in its language, the rewritten one): `item.titleRewritten`, with
`item.titleAsPublished` the title as the medium wrote it, in the briefing for every title changed. The log has each
change (`title rewritten by the AI: "A" -> "B"`). Any failure leaves the title as it is. Three steps, `bench/neutral-gate.mjs`
on 300 titles of the cards of 14 days: `judgedTitles` (one call for 40 titles, 10 s) says which have a judgment, an emphasis or a call to click; only
those are rewritten (`rewrittenTitle`, thinking on); `sameFact` (the pairs 6 at a time) says whether the rewrite tells
exactly the same fact. Results, the 59 rewrites read by hand (OK: same fact, the bait gone; mild: a detail or a
shade lost; bad: a fact added, changed or the news itself lost):
- Step 1 flags 78 titles of 300 (26%). It over-flags (« Alarm at Real Betis… », « Controversial goal »,
  « Landmark… case » are facts or borderline) and misses a few mild ones (« Premier League explain 'unbelievable'…
  Man Utd left gutted », « Even cases from Djibouti… are above Infantino »). The second opinion is the safety, so a false
  alarm costs tokens only.
- 78 rewrites: 59 proposed, 15 refused by the checks of the code, 4 failed (the AI did not answer, Gemini internal error:
  the title stays as published). The 59: 31 OK, 14 mild, 14 bad (« Referees, trick or treat? » -> « Refereeing in
  Juventus-Rennes? », « Financial services bet big… » -> « …increase sponsorship… », « The battle to take back the
  controls… » -> « The election for the presidency… », « New scandal shakes FIFA » -> « New allegations against FIFA »).
- The second opinion with thinking on accepted 22 of the 59, **all 22 OK; it stopped the 28 mild and bad ones**, and
  also 9 OK ones (strict: « When money scores goals » taken out, « Congratulations to »). With thinking off it accepted
  24: 20 OK and 4 mild, and stopped 11 OK ones. Thinking on cost 1.7k tokens a call of 6 pairs, off 0.2k.
- So automatically: 22 titles of 300 (7%) would change, by hand all right (« Historic: from this matchday… », « vicious
  attack », « world-class pitches », « Quietly Paid », « drags GFA to FIFA » -> « takes GFA to FIFA »). 22 right of 22 is
  a small sample: it does not show the error is under about 12%.
- Cost for a briefing of 25 cards: about 6 titles rewritten, 20 s each with thinking (5 of 78 calls timed out at 120 s and
  went to Gemini), 21k tokens in all, a minute or two if the titles are done one after the other.

**More titles by default** (10.11.2026, a friend of the user: the button of the editor works well; the user: "il y en a que 6% qui sont réécrites, ça
devrait être par défaut"). On 536 cards of 14 days, 31 titles (5.8%) were rewritten, 17 more were a rewrite the checks or the second opinion had refused
(`bench/title-proposals.mjs`). The bottleneck is the second opinion, not the judge: on 300 titles of the same 14 days (`bench/neutral-gate.mjs`) the judge flags
62 (21%), the AI rewrites them, 43 pass the checks of the code, and the strict second opinion ("EXACTEMENT le même fait", "dans le doute, non") keeps 24 (8%).
The 43 rewrites were rated by hand before the verdicts were read (`bench/data/neutral-gate-1110-labels.json`: 33 right, 9 mild, 1 bad); the strict opinion
kept 23 right, 1 mild, no bad, and stopped 10 right ones (« A new dawn? Kenya launch ambitious strategy » -> « Kenya launch women's football strategy »,
« Beyond the Pitch: Why the IGG's Probe… Marks a Turning Point » -> « The IGG's Probe into FUFA and Ugandan Sports Governance »). A second opinion on the
**main fact** (`sameFactPrompt` with `loose: true`: the judgment, a detail, a nuance and the wording may go; the actor, the action or result, the figures, the
certainty and what someone said may not; a doubt keeps the rewrite) keeps 38 (13% of the titles): 31 right, 6 mild, **1 bad** (« FIFA yielded under pressure from
UEFA - Disputed documents available… » became « FIFA provides documents to UEFA - … », a recipient the title did not have), the same on two runs
(`bench/neutral-loose.mjs`). It is now the default of `aiRewrittenTitles`; `NEUTRAL_TITLES_CHECK=strict` brings the strict one back. 43 pairs: it does not
show the error is under about 7% of the rewrites. The code checks stay (a name, a figure, a negation, a quotation, a question). **Not widened**: the judge. The 60
titles it left (of 300) rewritten all the same, as the button does for any title: 48 neutral already, 11 changed, all of them one word (« key », « already »,
« successful », « record », « set to make history »), one losing a fact (« expects a record $5 billion » -> « expects $5 billion »). The title as published is one
click away on the card (« Show the title as published ») and in the editor of the e-mail. A title both translated and rewritten has two originals, two buttons: « Show original » (the title in its language as the AI rewrote it, with the sentences of the article) and « Show the title as published » (the medium's own words, in their language, not translated); each line it shows says which it is (« German, as the AI rewrote it », « As the medium wrote it, German »). 7 live cases (family `titlesame` of `tests/regression`): a single
pair asked alone is judged more strictly than in a batch of six (the card of the subpoenas of the Democrats, accepted in a batch, refused alone: left out).

## Cards of one news

Two cards of one news that were not joined (the user, 03.11.2026: cards 1 and 2 of a briefing of Enzo's profile,
"Official: Galliani backed by Players and Coaches" and "FIGC Presidency: Italian football on the brink of a major
shift!"). No threshold of the vectors separates them: on 25 briefings of 12 days, the centroids of the two cards
that were the same news are at 0.695 and 0.879, while two different facts of one affair (UEFA's 42 questions and
FIFA's answer) are at 0.92 and 0.86, and 8 of 9 pairs between 0.68 and 0.70 are different facts. Lowering the
threshold of the stories (0.70) would join more of them than it should. The step that decides is the AI
`mergeStories` (the later card joins the first when it tells the same fact; "in doubt, no": joining wrongly hides a
news). Replayed on 8 briefings (`bench/merge-replay.mjs`): the prompt of now joins none, a variant that asks whether
the card above already answers it (`redundant`) joins the 2 duplicates found and 5 more, 4 of them other
developments of the same affair (a question and its answer, a candidacy and the election calendar). Not changed.
A flag on the card for the reader ("maybe the same news as card 1", from that variant, joining nothing) was proposed
the same day and put aside by the user, to come back to later.

## News told before the window

A friend of the user (10.11.2026, "one of the most important problems"): a big affair is taken up again the next day, and a week
later by media that wrote nothing before, so the briefing of today carries as news a fact known for days. Repeats of the last 48 hours
(`repeats.js`) only cover the cards sent by e-mail; this covers the facts the media had already reported, whatever the reader saw.

**The rule** (`services/utils/old-news.js`, `notOldNews` after the candidates are picked and before the AI chooses): for each candidate whose
story the media had told at least 12 hours (`GRACE_HOURS`) before the window began, the AI is given the headline, up to 5 earlier news (one per
medium, the closest to the story by meaning first, with their age) and up to 8 news of the window, and says whether the fact of the headline is **new** (it happened, was
announced or decided in the window, the event itself after its preview, a step further in the same affair) or **old** (the earlier coverage already
told it: a medium picking it up late, a reminder, a recap, an analysis, a reaction to an old fact, a preview of an event played since). In doubt it
is old. The old ones are not candidates; the log says them (`Briefing: 3 stories left out, the media told their news before the last 24 hours and only
tell it again` and one line each with the earlier fact). 30 stories a call, in parallel; a story that follows a card of before (`followUp`, already
judged on what is new since), one with no earlier news and one with no news in the window are not asked. The earlier news are read from every
medium, not only the reader's (`StoryModel.earlierNews`): they only tell the AI whether a fact is old. The briefing never fails on it: a failed
query or call keeps every story, and when all of them were judged old none is left out. A news the reader adds by its link is never judged.

**Why not the age alone.** On 14 saved briefings (336 cards of 3 profiles, `bench/old-news-age.mjs`) the first news of the story is older than the
window plus 12 hours for 26% of the cards, but a story of the grouping is long (a week of one affair: 1 000 news, 400 media): the older news are often
another fact. 40 of those cards drawn at random were rated by hand **before** any method ran (11 old, 23 new, 6 unsure, `bench/old-news-pack.mjs`,
`bench/data/old-news-labels.json`): the age alone (drop what has earlier news) caught 10 of the 11 old and lost 18 of the 23 new, 36% of its drops
right. The AI (gemma4:31b, `bench/old-news-methods.mjs`): without a grace it caught 8 of 11 and lost 4 of 23, with 12 hours 8 of 11 and 2 of 23 (80% of
its drops right), thinking on changed nothing. The prompt was set on that first set. On a second set of 26 stories drawn after with another seed and
rated before the method ran (7 old, 17 new, 2 unsure): **4 of the 7 old caught, none of the 17 new lost**. Both sets: 12 of 18 old caught, 2 of 40 new
lost. The old ones missed: a viral news told by 4 media two days ago and by 100 today, a statement told by two media only, a story whose earlier news
are in another story of its affair. The ratings are the assistant's, from the titles and their dates: a rule of the date of the **fact**, not of the volume
of the coverage. Of all the cards, about 7% were old news: about 5% would be left out, and about 1 in 20 new facts of a story begun earlier replaced by the next candidate.
Live, on a briefing of 10 cards of the profile of Enzo (43 candidates, bench/enzo-measure.mjs): 2 candidates left out, the old fact told by a Greek story three days earlier and the
preview of a match played since; one call of 1 341 tokens in and 178 out (the stories of the candidates that have earlier news, 30 at most a call).
The live cases of the corpus (`tests/regression`, family `oldnews`, 10 stories of the two sets: 5 old, 5 new) hold 10 of 10, each asked alone; a feature on the candidate Tashima, told
a week after his candidacy, is judged new when asked alone and old among others (the other stories give the AI its measure): that case was left out of the corpus, a limit of the AI.

**The closest earlier news first** (10.11.2026, `StoryModel.earlierNews`): the 5 earlier news given were the first in time of the story; they are now the closest to the story
by the cosine of the vector of their text to its centroid (their closest one for each medium; a news with no vector yet, or a story with no centroid, after the others, in
time). Measured on the 66 stories rated by hand (`bench/old-news-thread.mjs`, 3 runs, majority): first in time: 11 of the 18 old caught and 5 of the 40 new lost; closest first: 12 and
4 (precision of the drops 69% -> 75%). A story with 3 to 5 earlier news was judged on the oldest, not on the one that
told its fact. **The affair as the earlier coverage was measured and not built**: the 5 closest of the whole affair caught 15 of 18 and lost 5 of 40, but its part for the
stories with no earlier news of their own (10 more asked) caught 1 old one, by luck (its neighbours told another fact), lost 1 new one and left 1 unsure; the closest news of
the affair have the same similarity for the old and the new (median 0.89 and 0.90). The same method lost 2 of 40 new in the morning and 5 of 40 in the same run: 1 or 2
stories are noise with 18 old ones.

Not done: the affair (thread) as the earlier coverage, for a story that begins after its affair did (one old news of the second set had its earlier
news only in the thread); and the threshold of a week the friend named: a window of 24 hours already asks for the facts of that day, and the AI says
which is old.
