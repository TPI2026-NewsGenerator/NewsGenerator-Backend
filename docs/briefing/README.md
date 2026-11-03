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
   page, the titles lose the bait of their medium ([neutral titles](#neutral-titles)), the cards are read
   again with their passages to leave out the ones on what the reader refuses
   (`reviewCards`), the titles of the cards kept with a judgment inside their sentences are rewritten by the AI when a
   second opinion says they tell the same fact ([neutral by default](#neutral-by-default-evaluate-rewrite-verify)),
   and the titles in another language are translated. A card that can't be read takes the next
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

## Neutral titles

A card shows its title without the bait of its medium ("Information incroyable !", "Bomba zilei!", "Êtes-vous d'accord
avec lui ?") when it has some (the user, 03.11.2026). The AI is asked once for all the titles (`neutralTitles`,
`services/utils/neutral-titles.js`) which teaser each one starts or ends with, copied as it is; it never rewrites.
The code takes a teaser out only when it is a whole sentence apart from the rest by its punctuation, at most 6 words,
with no figure, no negation, no acronym nor capitalized name (the fact of the title), not in a quotation and not
a word of status ("Official"); and leaves the title as it was when fewer than 3 words or less than half remain. It
also takes out the exclamation mark at the end of a title and turns the ones between two sentences into full stops
(not in a quotation, not "Yahoo!"). The title as published stays in `item.titleAsPublished`: the card says "Title
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
