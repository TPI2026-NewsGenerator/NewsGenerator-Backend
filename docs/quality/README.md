# Quality > How right the detectors are

NewsGenerator decides many small things on its own: whether an event carries the badge Official, Contested or Unverified, which
countries a card is about, which item of Wikidata a name is, which news are worth a reader's time, whether two news tell the same
fact. Each of these was measured before it was built, on real news, and most were measured again after a change. This page gathers
every figure in one place, with the sample it comes from, its date and the bench that makes it again. The rule of the project is the
one of [the corpus of regression](../testing/README.md): a figure is a fact about a sample, not a promise; when a change makes it worse,
the page says so.

Dates are those of the measure. Most figures of the badges, the hedging words, the countries and the names are of **11.11.2026**,
measured on the code as it was built that day.

## How the figures were made

- **Precision** is the share of what is shown that is right (of the badges or countries shown, how many are right). **Recall** is the share
  of what deserved to be shown that is shown. A detector that shows little can be very precise and find little: both are given.
- **Shown per 100** is how often a badge appears on 100 events of the sample (natural proportions: the sample is weighted back to the real
  share of events with and without a word).
- **Strict / lenient** (countries): strict = both judges name the country; lenient = at least one judge does.
- **Judges.** Most "judged blind" benches use AI agents as judges, given the definition the product's AI has and never shown what the
  product answered (two judges per chunk, their agreement is given when measured). "By hand" in the log is a reading by the developer's
  assistant, not by a third party. **Judges are AI too and share the definition**: the real gain of a change may be smaller than the figure.
- **The benches** are scripts under `bench/` (read only on the briefings and the database); their data is under `bench/data/`, which
  is not kept in git. Where a bench is in the repository, it is named in the table.
- **In-sample.** A rule built after reading the errors of a sample is optimistic on that sample. Where a second sample of cards the rule had not
  seen was judged, both are given.

## The latest figures

| What | Precision | Recall or coverage | Sample | Date |
|---|---|---|---|---|
| Badge **Official** of an event | 97% | 41% (shown on 7.5 events in 100) | 230 judged events of 3 profiles | 11.11.2026 |
| Badge **Contested** of an event | 93% | 62% (shown on 4.4 in 100) | the same 230 events | 11.11.2026 |
| Badge **Unverified** (formerly Reported) of an event | 94% and 95% in the two runs (the docs of the affair give 89 to 95%) | 31% and 33% (shown on 2.1 in 100) | the same 230 events | 11.11.2026 |
| Hedging **words** alone (a news marked "no confirmation") | 53% on 402 news (51% of 93 news read before the words were rebuilt) | about 31% of the hedged news | 402 news judged by 2 blind judges | 11.11.2026 |
| **Countries** of a card | 92% strict, 96% lenient | 70.5% of the countries both judges name; 6 wrong in 168 shown | 240 cards, 2 samples of 120, 4 blind judges | 11.11.2026 |
| **Name linking** (item of Wikidata, card context) | 93% right (stored links before: 67%) | 8 names lost of 240 (23 before) | blind bench of 240 names | 22.10.2026 |
| **Ranking** of the news for a profile (vector per interest + AI) | 95% relevant in the top 10, 35 of 40 fully | one vector for the profile: 38% | 4 profiles, top 10 | 24.09.2026 |
| **Relevance of the cards** a reader got | 97% relevant, 90% fully | | 61 cards of dry briefings of real readers | 07.10.2026 |
| **Grouping** of news into one card (bge-m3) | 96% of the cards right (trigram: 82%) | | the bench of 24.09.2026 | 24.09.2026 |
| **Translation** meaning errors | the AI: 2.3% (DeepL: 9%) | | 310 texts | 16.10.2026 |
| **Per-card AI analysis**, cards with a bad line | 5% with thinking on (27% off) | | 74 cards | 15.10.2026 |
| **AI proofreading** of a card's pieces | 0 false alarm | 191 of 193 planted defects found | 480 cards | 09.11.2026 |
| **The same news twice** (see "Duplicates" below): cards of one briefing | 16 true pairs in 12 of 47 briefings (990 cards) before the fold of card-merge.js; the two readers give 17 pairs, 11 true | 11 of 16 | 47 saved briefings, 3 profiles | 12.11.2026 |
| **The same news twice**: a card of a briefing already told by a card of the 48 h before | 70 of 858 cards (8.2%); the "did it evolve?" check keeps 18 of the 20 same-news cards it is given | the proposed check of two readers: 59 of 70, 16 developments flagged | 47 saved briefings | 12.11.2026 |

The sections below give each of them with what came before and what is known to be wrong.

## The three badges of an affair

An *event* of an affair (a development of a story the reader follows) can carry **Official** (a party says it itself: a statement, a
communiqué), **Contested** (any contestation of the fact of the news) and **Unverified** (the coverage presents the main claim as
unconfirmed). They are read from the news of the event ([the affair](../briefing/affair/README.md)).

The sample: 150 cards of the last briefings of 3 profiles, 71 affairs, 912 distinct events, mostly the Infantino and FIFA saga; 230 events judged
(46 carrying a mark, 84 with a word but no mark, 100 of the 782 with no word), by 2 blind judges a chunk of 58 (agreement: Official 88%,
Contested 96%, Unverified 97%).

| Stage (all 11.11.2026) | Official | Contested | Unverified |
|---|---|---|---|
| **Before**: words and an AI that reads the title only | 3.7 in 100, 100% (34 of 34), recall 10% | 0.3 in 100, 100% (3 of 3), recall 5% | 0.8 in 100, 57% (4 of 7), recall 7% |
| An AI that reads the event alone | shown on 25 in 100, 90%, recall 59% | 6 in 100, 81%, recall 79% | 9 in 100, 68%, recall 96% |
| The AI **and** a word in some news | 100%, recall 17% | 91%, recall 17% | 95%, recall 38% (2.4 in 100) |
| **Built**: the AI reads each event; Unverified also needs a hedging word | 30.5 in 100, 85%, recall 68% (definition then wide) | 4.2 in 100, 95%, recall 61% | 2.0 in 100, 94%, recall 31% |
| Official **restricted to statements** and communiqués (the AI and a word of statements.js), truth judged again by 4 blind agents | 5.9 in 100, 98%, recall 32% (3.5 in 100, 97%, 19% with the same truth before) | 4.4 in 100, 93%, recall 62% | 2.1 in 100, 95%, recall 33% |
| **Latest**: Official with its own list of statement words (29 entries) | **7.5 in 100, 97%, recall 41%** | **4.4 in 100, 93%, recall 62%** | **2.1 in 100, 94 to 95%, recall 31 to 33%** |

What the table says: before the change the badges were right when they showed and almost never showed (the AI saw the title only and the
words were narrow, two weak recalls multiplied). Now they show more often (recall 41%, 62% and 33% against 10%, 5% and 7%) at a precision of 93% or more. A run of the AI
varies by a few points; the ranges are those of the runs made.

Known limits, as measured:

- **Official** false positives are the pages of a body that only list data (team profiles, standings), quotes, a candidacy filing. The AI alone, with
  the restricted wording, reached 24.8 in 100 at 64% weighted precision (86% raw): that is why a statement word is also required.
- **Contested**: the wording was made stricter once after a first run at 69% precision (a criticism or a protest taken for a dispute), so its
  figure is the least independent of the three.
- **Unverified** still misses the soft hedges ("habría", "could"); the AI alone as a detector over all news flags 33 to 46 news in 1,000 at 43 to 47%
  precision, which is why the words are kept.
- The judges' definitions are broader than the tooltips (Official included interviews, Contested included appeals); the judges saw the news with
  a word first, which favours Unverified on an event where one news in twenty hedges.
- 230 events, 3 profiles, mostly one saga. Before the change only 7 and 3 badges were shown to judge a precision by.

Cost: 40 calls and 91,000 tokens for the 230 events (6 events a call, 3 calls at once, no thinking, about 400 tokens an event, 13 to 18 s); in
the product only the new and grown events are asked. Benches: `bench/hedging/events.mjs`, `bench/hedging/event-marks.mjs`.

## The badges and lines of a card

| Detector | Sample | Result | Date |
|---|---|---|---|
| **Contested** line (denial sentences by words in 5 languages, then one AI call a card; about 300 tokens a card) | 100 stories of politics and world news and 97 cards of 2 media or more | 22 cards would carry it, **21 right** (Iran denying any role, Bardella's camp, Manchester City); one sentence of a journalist read as a denial. Comparing what the articles say instead: pairs of sentences 40% right, "another version" 35%: not built | 05.10.2026 |
| **Official source** (the party's own posts, checked twice, never a denial) | 163 cards of 4 readers over 7 days, judged by hand | 19 cards got a right official post, none a wrong one, 5 of them debatable. Denials found over three runs: all wrong, so none is ever shown. Posts embedded in the articles: none the parties' own (27 posts on 15 cards) | 12.10.2026 |
| **Reported statements** (statements.js: a sentence where the party makes it official itself, asked twice) | the same 163 cards | 24 cards, **20 right** (17 without an official post); the 4 wrong ones were an expert's opinion, an older announcement, "a source of Benfica", a past decision: the prompt says them and a sentence counts only when two answers read it so. Measured in the 7 languages of the list | 13.10.2026 |
| **Not confirmed** line, the search filter and the field `marks.hedged` of the API of the news (all read hedging.js) | see the next section | | 11.11.2026 |

More in [the official source](../briefing/official-source/README.md) and [the denials](../briefing/denials/README.md).

## The hedging words

`hedging.js` lists, by language, the words an article uses to say it has no confirmation ("reportedly", "selon des sources",
"σύμφωνα με πληροφορίες"). It was never measured until 11.11.2026.

| Measure | Sample | Result |
|---|---|---|
| First ever measure | 2.06 million news of 14 days; 93 marked news read one by one by one reader, not blind, ±15 points a language | **51% really said "no confirmation"** (English 58, Spanish 11, French 69, German 82, Italian 38, Portuguese 75); 24 of 93 were the "alleged" of a crime report (15 of 19 in Spanish), 22 a rumour denied, over or confirmed, the Italian "rumore" (a noise) or a word inside another. From Greek on, one news in five, **no word was found**: the list read five languages |
| Rebuilt (37 entries, about forty languages, "allegedly" and "presunto" dropped, a rumour denied is no hedge) | the same 14 days; 99 corpus cases from real titles | share of news marked: English 2.2 to 1.6%, Spanish 1.4 to 0.3%, French 0.64 to 0.66%, Italian 0.5 to 0.24%, German 0.67 to 0.78%; from 0 to 0.1 to 2.4% in the languages after Greek. "navodno" stays about a quarter crime reports |
| An AI veto on the words' mark (measured, **not built**) | 402 news (168 marked by the words, 234 not), 2 blind judges, 97% agreement | precision of the words alone **53%**; the veto with the title only takes out 104, 31 of them real hedges (no use); with the title and 600 characters it takes out 59, 56 rightly: **precision 82%** (63 to 85% at natural proportions), 3 of 83 real hedges lost; thinking on adds 4 points for six times the tokens. The judges call hedged about 2% of the news; the words find about 31% of them |

So the words alone are a way to look first at the news that hedge, not a verdict: that is why the badge Unverified also needs the AI reading
the event, and why `marks.hedged` of the API says it is "words found, not a verdict". Benches: `bench/hedging/coverage.mjs`, `find.mjs`, `verify.mjs`, `veto.mjs`.

## The countries of a card

How the countries are found: GLiNER tags the names, each name is linked to an item of Wikidata (the AI chooses among the candidates), the
item gives a country, the countries are weighted by the news naming them; an AI then keeps the ones the news is about. Details in
[names on cards](../following/names-on-cards/README.md). Two samples of 120 cards each: the first, of the 14 last briefings, is the one the
rules were looked at on; the second is of 14 older briefings, with no card in common, judged by 2 new blind judges (identical labels on 117 of 120).

| Pipeline run again, with the code of 11.11.2026 | Sample 1 (strict / lenient, found) | Sample 2, new cards (strict / lenient, found) | The two together (240 cards) |
|---|---|---|---|
| Before the reading | 77% / 82%, 78% | 90% / 92%, 71% | 83% / 86%, 74.5% found, 27 wrong |
| + the **reading** of the AI with no candidate | 84% / 89%, 74.5% | 94% / 97%, 71% | 89% / 93%, 72.7%, 13 wrong |
| + **first country only** on a card naming an international body (built) | 90% / 95%, 72.6% | 95% / 98%, 68.4% | **92% / 96%, 70.5%, 6 wrong** |
| Not built: first country only, everywhere | 91% / 96%, 68.9% | 96% / 98%, 67.5% | 94% / 97%, 68.2%, 5 wrong |

- **The reading holds on both samples**: wrong countries 27 to 13, and a few points of countries found. An AI that reads the card and names the
  countries itself, with no candidate, finds 96% of what the judges name but is right on 77%; the countries the pipeline decided **and** that AI names too
  are right on 91% in the simulation on the judges' text, 85% (84% in the last run) end to end with the production text. The figure to retain is the end-to-end one.
- **The rule generalizes poorly.** Before the rule, the first country of a card was right 92% of the time, the second 40%, the third 50%: 7 of 10
  wrong countries were secondary ones, almost all on the cards of the politics of the FIFA (the other hosts of the World Cup 2030, the countries that
  support Infantino, the nationality of a referee). On sample 1 the rule took 6 wrong countries off and lost 2 right ones; on the new cards, 1 off and 3 right ones lost
  (India–Pakistan, Russia–Ukraine, the Nigeria–Brazil final: a match of two countries on a card that names a body). Over the 240 cards it is worth about
  3 points of precision for 2 of countries found, and the gain comes mostly from the week of the FIFA election. More readings of the AI do not help (the
  three readings agreed on the wrong countries).
- **A definition dispute.** The judges leave out the country of a person who runs for an international body unless the news is about their country, so the
  FIFA candidates (Wenger, Vega, Tashima) show no country. An earlier measure (19.10.2026) kept them.
- The saved briefings of sample 2 (82% precision, 61% found) are of older code and are not comparable with the pipeline run again (90%, 71%).
- Cost of the reading: about 170 tokens a card, 5,000 for a briefing of 30 cards (8 calls, 17k tokens in and 3k out for 120 cards).

Earlier measures, still valid, of the same feature:

| Measure | Sample | Result | Date |
|---|---|---|---|
| People of an international body leave their country only on the card that names the body, and national federations are not international | 173 cards of 14 days naming an international body, 84 where the rules differ; truth by hand | every person left out: 46 right, 38 wrong; people of the body on the card only: 63 / 21; + national federations: **79 right, 5 wrong** (the 5: a Croatian referee taken for a Filipino, "FMF" for Moldova, The New York Times "United States", a French journalist on a CAF card) | 19.10.2026 |
| The AI chooses among the candidates of Wikidata | 150 cards of 14 days, 117 with a candidate | 27 change (9 to none, 16 to fewer countries, 2 with another); about 20 better, 4 worse (the Fox CEO's United States, a Corriere dello Sport columnist's Italy, Wenger's France, a Tunisian newspaper's Tunisia) | 03.11.2026 |
| A news medium gives its country only when nothing else does | 529 cards | 12 name a medium; 3 wrong countries fixed (France for a Romanian card that cites L'Équipe), 1 right Italy lost | 03.11.2026 |
| The country of an organisation by its name (6,834 adjectives of nationality) | 590 cards of 40 briefings (185 without a country) | adjective rule: 76 cards, 62 agree, 14 added (12 right, 1 federation named in passing, 1 doubtful); prefix rule: 28 cards, 19 agree, 4 added right, 5 wrong (two-letter codes, a place): fixed by 4 letters and organisations only | 08.11.2026 |
| The country of the person of an international body is no longer offered to the AI | 60 briefings | 67 such candidates, **kept 0 times** (before: kept in 2 runs of 5) | 08.11.2026 |
| Declined country names ("Rosji", "Suomeen") | 76,946 place mentions | 1,217 unlinked found, about 99 in 100 right; 4-letter stems rejected (Leeds is not Lithuania) | 08.11.2026 |
| Cards with no country: a second question for a card with no candidate | 400 cards of 21 days | 31% had none; the question was asked for 43 cards, the AI kept a country for 22, **all 22 right by hand**, 21 refused rightly, 1 missed; cards with no country 31% to 25% | 10.11.2026 |
| Country names in 23 more languages (Persian, Urdu, Pashto, Thai, Hindi, Bengali...) | news of 14 days | "ایران" was named by 1,818 news and read as no country; now read; 18 corpus cases | 11.11.2026 |

## Names: linking them to Wikidata

A name the tagger finds ("Mourinho", "UEFA", "손흥민") is linked to an item of Wikidata, or left with none: a wrong link is worse than none.
See [names](../ingestion/names/README.md) and [names on cards](../following/names-on-cards/README.md).

| Measure | Sample | Result | Date |
|---|---|---|---|
| **Blind bench** of the links, judged before any system | 240 names | stored links 67% right (96 of 171 linkable names linked, 69 left, 10 wrong of 107 linked); the AI with a plain prompt 89%; **the AI with the topic of the card, its other names and the countries of its sites 93%** (names lost 23 to 8); a vote of 3 shuffled orders 95% at three times the tokens. About 6% of names have no candidate for a real item (nicknames, inflected forms) | 21.10.2026 |
| Check of the names of a card (the AI reads titles and the countries of the sites; items in 60 Wikipedias or fewer) | 242 names | the 14 wrong ones caught, 2 of 218 right ones left out; about 1,500 tokens a briefing | 21.10.2026 |
| A person with **one** exact item: linked only if human and in a Wikipedia, else the AI with 5 titles | 161 judged | 116 right, 0 wrong (old rule 123 right, 38 wrong); 507 persons relinked | 20.10.2026 |
| An organisation with **one** exact item (the Al-Hazm case) | 122 judged | old rule 93 right, 6 of the right country only, 23 wrong (EU the commune of Eu); new rule **96 right, 3 of the country, 1 wrong, 6 lost**. The AI for every one: none wrong but 12 lost and 5 times the calls | 20.10.2026 |
| A **word alone** keeps its item only if human, its label is the word and it has 20 Wikipedias | 174 judged | 87 right / 87 wrong to **107 right / 7 wrong**; 1,242 relinked | 21.10.2026 |
| Organisations chosen by the AI among the candidates (5 titles) | 60 organisations never linked | 50 picks, 45 right (90%); keeping those in 10 Wikipedias at least, 44 of 46 (96%) | 18.10.2026 |
| **Homonyms** of a full name (the famous one and the others) | 67 persons never linked, truth by hand | threshold 30: 5 right, 0 wrong, **54 missed**; 10 Wikipedias, 3 times the next and a guard against bylines: 32 right, 0 wrong; + the country of the media: 35 / 0; 5 Wikipedias: 40 / 0. Missed: strong namesakes (Mourinho, Alcaraz, Guardiola) | 19.10.2026 |
| Names in **Korean, Japanese, Chinese** letters | 172 persons seen 3 times or more, real Wikidata | **119 linked = 69%, against 0**; by hand 3 wrong of 119 = 2.5% (the Latin rule: 2 of 107). Four causes fixed: the tagger cut Japanese at the changes of alphabet, `isFullName`, the language of the name, particles and titles | 11.11.2026 |
| **"Japan FA"-style** names (a country and "FA", "football federation"...) | 404 organisations of this shape | the rule takes 198 names (3,146 mentions), 143 with no item, 55 already on the same association, **zero linked to another item**; for the API of the news over 30 days **+574 news in 61 associations** | 11.11.2026 |
| **"FA" alone** | 2,920 mentions with no item | 74% of the news that write "FA" also name a longer name that holds it ("FA Cup" 264, "Japan FA" 85): that was an artefact of the cleaning, no longer added. The 371 bare ones are the English FA, the Frente Amplio or Football Australia: no item, the card chooses | 11.11.2026 |
| **Acronyms of associations** ("FPF", "FKF", "SAFA"...) | the 69 organisations with no item that bear one (4,598 mentions) | linked **only when the country of the sites that write it is the country of an association that has it**: 11 names taken at once (1,622 mentions: FPF 894, SAFA 149, FKF 144, AUF 94...), 25 offered to the card only, 33 left. Linked without a country was rejected: "CSA" is a Romanian club and a French regulator, "FSF" the Senegalese federation | 11.11.2026 |

The 11 names linked by `bench/countries/association-acronyms.sql` reach **1,197 news** the API of the news did not return for these associations
(Portugal 649, Kenya 108, Uruguay 90, South Africa 85, Scotland 75...).

## Relevance, ranking and grouping

| Measure | Sample | Result | Date |
|---|---|---|---|
| **Ranking** of the news for a profile | relevant cards in the top 10, 4 profiles | the keyword filter of the time 65% (14 of 40 fully); **one vector for the whole profile 38 to 40%**; one vector per interest 88%; **+ the AI reranking the best 40: 95%, 35 of 40 fully relevant**. The AI returns short lists (chef 2 to 3, dog 6 to 7, precision 27 of 28) | 24.09.2026 |
| **Relevance of the cards** a reader got | 61 cards of dry briefings of real readers, judged by hand | 55 fully relevant, 4 partly, 2 not: **97% relevant, 90% fully** (24.09: 95% and 87.5%, on invented profiles); the vectors alone, top 10 of 80 candidates: 79% | 07.10.2026 |
| One vector of the whole text against the interests split by the AI | one reader (profile 7) | relevant news in the head, interest vectors against the whole text: top 10 8 against 5, top 42 24 against 24, top 100 48 against 50, top 200 69 against 74. The whole text adds no gain; what is lost is the niche items (a national federation's election) crowded out by one big event | 06.11.2026 |
| **Grouping** of news into a card (bge-m3 dense and sparse, average link 0.70, against trigrams) | the bench of 24.09.2026 | **96% of the cards right against 82%** (the media count shown right: 91% strict against 75%); trigram OR dense only 50% | 24.09.2026 |
| Two cards of two languages joined as one (the same fact asked of the AI) | pairs from 0.75 | 34 of 35 right; the vectors alone merged Belgian and German inflation | 01.10.2026 |
| Versions in another language joined to a card, with the strict question "same fact" | 798 joins | the joins that were the same news: **68% before, 91% now**; 93 of 798 true joins (12%) lost; kept 32 of 35 true, left out 23 of 35 other facts | 10.11.2026 |
| Cards folded into one angle when two readers agree | 18 true pairs | one reader alone 14 of 18 but 11 of 27 pairs wrong; both agree **14 of 18, 1 of 15 wrong** | 09.11.2026 |
| **Age gate**: an old news told again is not shown as new (the AI says new or old; in doubt, old) | 11 old and 23 new news | age only: caught 10 of 11, lost 18 of 23 new (36% precision); the AI with a 12 h grace: caught 8 of 11, lost 2 of 23; hold-out: 4 of 7 caught, 0 of 17 lost | 10.11.2026 |
| A story that drifts over days (idle decay in the grouping) | 23 drifting and 12 one-fact stories | cut drift 4 to 14 of 23, one-fact stories cut 1 to 2 of 12 | 28.09.2026 |
| Unreadable cards and good cards removed by the review | 14 briefings; 264 and 237 cards | 8 unreadable cards in 14 briefings (about 1 a briefing); good cards wrongly removed 20 of 264 to **0 of 264** | 06-07.10.2026 |

## Duplicates

A friend of the user keeps meeting "doublons" (the user, 12.11.2026). Measured on the 47 ready briefings saved since 25.10.2026 (990 cards of 3 profiles),
every pair of cards whose vectors (bge-m3, title and first 60 words) were at 0.72 or more, every pair sharing a story or an article, and a sample of 40
pairs from 0.64 to 0.72, judged **SAME / DEVELOPMENT / DIFFERENT** by one AI judge (324 pairs), then the 112 pairs that judge called SAME (or DEVELOPMENT with
a vector at 0.85+) by a second one. A pair on which they split counts as DEVELOPMENT (the doubt hides no news). `bench/dup-eval.mjs`. A duplicate whose cards are
unlike in the vectors (under 0.64) was not looked for: the figures are a floor.

| Measure | Sample | Result | Date |
|---|---|---|---|
| **Inside a briefing**: two cards telling the same news | 47 briefings, 990 cards | **16 pairs in 12 briefings (26%)**; nothing shared by story or article but 3 old pairs. None of the 47 holds a card folded by `card-merge.js` (no `joinedCards`). The code was already on the machine that stays on in the tree of the deploy before 12.11.2026 (`server.old` holds `card-merge.js` and the call in `briefing-service.js`; the day of the first deploy is not known), yet the 10 briefings made since 10.11 have no fold, while the same function replayed on the saved cards of the briefing 1208 (a true pair) folds it **3 times of 3, in 15 to 22 s**. In production it did not run or failed without a trace; the logs of the old container are gone (container made again 12.11.2026 13:37) | 12.11.2026 |
| The fold of two readers (gemma4:31b and deepseek-v4-pro, both must give the pair) replayed on the 47 briefings | 16 true pairs | 17 pairs given: **11 true, 6 developments of one affair (folded as angles, none hidden), 0 different**; true found **11 of 16**. gemma alone 11 true of 28 given, deepseek alone 12 of 18. Missed: two briefings with the pair "Bomb of the day (L'Equipe)" and "Csányi", a GFA pair, an IFAB pair, "Infantino's Advantage". 489 s for 47, 200,000 tokens read, 206,000 written | 12.11.2026 |
| **Across briefings** of one profile: a card of today telling the news of a card received in the previous 48 h (not a regeneration, 3 h) | 858 cards that had an earlier briefing | **70 cards (8.2%)**: profile 7 29 of 392 (7.4%), profile 137 21 of 262 (8.0%), profile 980 20 of 204 (9.8%). 41 of the 70 (59%) repeat a card **never sent by e-mail**, 17 a card sent that the filter let through as new, 12 a card sent kept as a follow-up | 12.11.2026 |
| Why a card sent got through as new (before any judging: the cards sharing a story with a card sent in the 48 h before, with no follow-up mark) | 23 cards | all 23 passed by `mergedStoryIds`: the story is chosen after `notShownBefore`, then `keepSameNews` joins to it a story of before (a version in the reader's language or in another one), which the filter never sees | 12.11.2026 |
| **"Did the news evolve?"** (`evolvedStories`, the prompt and model of the briefing) replayed on the 48 cards that share a story with a card sent | 20 SAME, 24 DEVELOPMENT, 4 DIFFERENT | it answers "evolved" for **42 of 48 (88%)**: 18 of 20 same-news cards kept, 4 developments left out. A living affair always has news since its card (a candidacy, a statement), whatever the card of today says | 12.11.2026 |
| Proposed: the cards of today read **against the cards received** in the briefings of the 48 h before, by the two readers of the fold (bench `cross`) | the 70 true cards, 123 developments, 26 different | both readers: 76 pairs given, **60 true, 16 developments, 0 different**; true cards found **59 of 70 (84%)**; of the 29 whose earlier card was sent 24 (83%) with 8 developments flagged. deepseek alone: 64 of 70 but 25 developments; gemma alone: 60 of 70, 38 developments. About 50 s a briefing (662 s for 40 at 3 at a time), 317,000 tokens read and 295,000 written for 40 briefings | 12.11.2026 |

The rule the user chose (12.11.2026): only a card **sent by e-mail** counts as read, and a news sent does not come back unless it evolved or the reader follows
the affair. On the 98 judged pairs whose earlier card was sent (29 SAME, 56 DEVELOPMENT, 13 DIFFERENT; 48 of them share a story, 20 of the 29 SAME):

| Check | Result on the 29 same-news cards | Wrong (a development hidden) | Date |
|---|---|---|---|
| The two readers of the fold, today's cards against the cards sent | 24 found (83%) | 7 of 31 flagged (23%) | 12.11.2026 |
| One pair look with the full texts, gemma4:31b ("does B tell something new?") | 8 (28%) | 0 | 12.11.2026 |
| The same look by deepseek-v4-pro with reasoning | 15 (52%) | 1 of 16 | 12.11.2026 |
| The two readers, then the pair look of deepseek (both must say same) | 13 (45%) | 1 of 14 (7%) | 12.11.2026 |
| The two readers, then the pair look of gemma | 8 (28%) | 0 of 8 | 12.11.2026 |
| **Built** (`sent-repeats.js`): a story shared with a card sent, or paired by one reader of the list, then the look of gemma4:31b with reasoning | 11 (38%), none hidden of 56 developments; with deepseek 14 and 1 | 0 | 12.11.2026 |
| The look judging "a NEW EVENT" (details do not count), gemma with reasoning | 28 of 29 | 23 of 56 developments called the same news: dropped | 12.11.2026 |

The look pair by pair is stricter than the two judges (they called SAME some pairs where a card adds a detail): it is the safe side for a rule that must not hide an evolution.

Not measured: what the reader read on the page (the page counts nothing since the tracking of the cards seen was dropped on 14.10.2026: "not sent by e-mail = not read"),
duplicates with unlike vectors, and the cost in cards a wrong flag would hide (a development of one affair).

## Language and translation

| Measure | Sample | Result | Date |
|---|---|---|---|
| **Translation**: the AI (gemma4:31b) against DeepL | 310 texts | meaning errors **AI 2.3%, DeepL 9%** (10% with the source language forced); the AI costs cents a month, DeepL about 30 euros: DeepL rejected | 16.10.2026 |
| **Language of a news** (words and letters, the label of the feed ignored) | feeds in Portuguese, Czech, Polish | Portuguese 73.5 to 92.5%, Czech 59.9 to 87.4%, Polish 96.7 to 99.6%; a feed in several languages gives its news no language (40.8% right against 84.1% without the feed's language) | 14.10.2026 |
| **Figure guard** (a translation must keep every figure) | 528 cards | false positives fixed (1/8 finals against round of 16, 18.30 Uhr, Arabic digits, numbers in words); the real catches kept ("500,000 euro bonus") | 30.10.2026 |
| **Title of an official post** (the party's own post of a card): its language read from the letters of its title | a Vietnamese post ("LĐBĐVN KIÊN QUYẾT XỬ LÝ...") shown untranslated to an English reader (a friend of the user, 12.11.2026); not measured on a sample | the short words know 9 languages and franc wants 200 letters, so a title of a post had no language and was never translated; it is now read like the titles of the angles (`translatedTitles`: the accents tell Vietnamese, a guess kept only when the translation differs); 2 corpus cases, 4 tests |
| **Untranslated text** seen by the reader | 80 briefings | before: 13 cards of about 700 with passages in another language, 8 titles; the old audit read the label of the feed (a Persian title of an English feed passed). Fixed by retries, a card replaced from the reserve, and an audit that reads the letters | 09.11.2026 |

## The writing steps

| Measure | Sample | Result | Date |
|---|---|---|---|
| **AI-written** bullet points and summary against the published sentences | 29 to 30 articles | articles with a meaning error: AI points 2 to 3 of 29, AI summary 3 of 30, **published sentences 0**. So the card shows the article's own sentences; the AI version is behind a button. Errors repeat from run to run, no model is error-free | 12.10.2026 |
| The AI-version writers compared again | 30 articles, 2 runs | articles with a **major** error (points / summary): gemma4:31b 1, 1 / 1, 1; deepseek-v4-pro 0, 0 / 2, 1; gpt-oss:120b 11, 4 / 9, 8. gemma4:31b is the fallback | 09.11.2026 |
| **Per-card analysis** (what changed, why it matters, what could come next) | 74 cards | cards with a bad line: **thinking on 4 of 74 (5%)**, 78% worth showing; thinking off 20 of 74 (27%), 47% worth showing. Triage of the cards that deserve one: deepseek off | 15.10.2026 |
| **AI proofreading** (dateline, caption, label, credit...): the AI only points, the code decides | 480 cards | gemma4:31b found 191 of 193 planted defects, 20 real ones no rule knew, **0 false alarm** (deepseek thinking on: 193, 4 false alarms, 228k tokens); in production 7 pieces out, all real, 220 of 220 planted defects restored | 09.11.2026 |
| **Neutral titles** by default (the AI judges, rewrites, a second opinion keeps only the same main fact) | 536 cards | 31 rewritten (5.8%), 17 kept as a proposal after the checks refused them (3.2%), 17 shortened (teasers, labels), 471 untouched. The loose second opinion keeps 38 rewrites: 31 right, 6 mild, 1 bad (a recipient added) | 10.11.2026 |
| **Neutral titles**, what the briefings already written hold | 429 cards of 19 briefings over 7 days (`bench/neutral-titles-stats.mjs`) | 56 titles rewritten by the AI and shown by default (13%), 24 left to the editor as a proposal the checks refused (5.6%: 12 second opinion, 5 name lost, 2 name added, 2 quotation, 1 each length, exclamation, question), 21 shortened by the code | 12.11.2026 |
| **The story so far** of a card: only the earlier news of its own affair (one AI call of about 450 tokens a card that has an analysis) | the 166 lines of 71 cards of 19 briefings over 5 days, read by hand by one reader (not blind, a small sample) | before: all 166 lines shown, about 66 of them (40%) of another affair: six lines of the NFF of Nigeria on a card of the FKF of Kenya, twenty of the other sports of the Youth Games on a futsal card. Now 93 shown, about **89 right (96%)**, and about 11 right lines taken out (11%): the sagas (the FIFA presidency, Real Madrid and the referees) lose some. Rejected: a rule by the countries of the items the news name (cut 17 lines, 8 of them of the same affair: the FIFA files, a tournament, a report seen by two countries) and the likeness of the stories (the lines of one affair are as low as the strangers); a wider wording that adds "a saga is one story" kept the sagas but also the other sports of the Games (110 shown, about 90% right) | 12.11.2026 |

## Search, speed and cost

| Measure | Result | Date |
|---|---|---|
| Keyword search with operators at 4.6 million news | "infantino" **35.2 s to 0.9 s** by folding the accents in Postgres on both sides (index `i_articles_search_plain`) | 11.11.2026 |
| Grouping into threads on the machine that stays on | the bottleneck of the ingest: `assign_threads` 56% and `assign_stories` 24% of the database's time; 300 stories 70 s to 4 to 8 s on 3 cores | 09.10.2026 |
| Cost of a briefing of 30 cards | about 390,000 tokens; about 8.5 million tokens and 5 to 6.5 dollars of credits a month for a profile | 11.11.2026 |
| Cost of the steps | names check about 1,500 tokens; contested about 300 tokens a card; official source about 900 tokens a card; countries reading about 170 tokens a card; per-card analysis about 0.08 dollar a briefing; neutral titles about 21,000 tokens | 2026 |

## What these figures do not say

- **Judges.** Most are AI agents with the definition of the product; the hedging 51% is one reader, not blind. Judge variance is real: the
  same analysis run had 24 bad lines with one round of judges and 39 with another.
- **Samples are small and football-heavy.** 120 cards a sample, 230 events from 3 profiles and one saga, 60 cards for the relevance of readers.
  A difference of two points is noise.
- **Rules built on the errors seen** (the first country on a card naming a body; the margins of the picture choice) are optimistic on their own
  sample; the second sample of countries is why the rule's gain is given at half of what the first sample suggested.
- **Not measured by themselves**: `marks.statement` and `marks.denial` of the API of the news (the words of the cards, on title and description;
  `statement` reads 7 languages, `denial` 5) have no measure of their own beyond the badges above.
- Some figures were measured on code not yet deployed at the time; the dates say which.

## Run them again

From `server/` (a database and an Ollama key in `.env`; nothing is saved by the benches that read):

```bash
node --env-file=.env bench/hedging/event-marks.mjs        # the three badges: sample, run, score
node --env-file=.env bench/hedging/veto.mjs               # the AI veto on the hedging words
node --env-file=.env bench/countries/measure.mjs build 120   # a sample of cards (COUNTRIES_DIR=... build 120 14 for older briefings)
node --env-file=.env bench/countries/measure.mjs run         # the AI reading each card
node --env-file=.env bench/countries/measure.mjs e2e         # the whole pipeline run again
node --env-file=.env bench/countries/measure.mjs score       # against the labels of the judges
node --env-file=.env bench/countries/acronym-gain.mjs        # the acronyms of associations
node --env-file=.env bench/dup-eval.mjs build                # duplicates: the saved briefings; then vectors, pairs, (judges), score, replay, cross, crossScore
pnpm run regression                                          # the corpus of regression, offline
pnpm run regression:live                                     # and with the real model
```
