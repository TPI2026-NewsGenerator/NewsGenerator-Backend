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
| **The funnel** of a briefing, profile 7 (24 h, 30 cards): the news of the database, the stories of the reader's 1 980 feeds, the stories scored, kept by interest, candidates, chosen | 189 281 news in the last 24 h in the database; 47 710 stories told by the reader's feeds; 1 800 scored; 450 kept by interest; **121 picked, 115 asked to the AI, 45 chosen**, 30 cards. 720 stories judged blind by 5 readers (the 450, 150 drawn among the 1 350 scored and not kept, 120 drawn among the 294 not scored with a word of the subjects) | **47 clearly for the reader among the 450 kept**, about 36 more among the 1 350 other scored ones (4 of 150), 1 of 120 among the not scored. Where the 47 are lost: 11 already delivered (the repeat filter, by design), **14 at the cut to 121 candidates** (ranks 91 to 597), 2 by the age gate, 1 by the AI; 19 chosen. many of the 52 clear stories are one news told in several languages (the housemaid complaint against Infantino, Blatter's "dictator", the FIGC elections): the number of different news was not counted, so "30 clear cards a day" is not shown to be missing | 12.11.2026 |
| The cut to the candidates widened from 115 to 200 stories (the choice replayed 4 times) | the same day | clear stories among the candidates 20 -> 29, **clear chosen 11-16 -> 17/17/17/17**, not for the reader chosen 2-4 -> 3-4; the call of the choice reads about 9 000 tokens more. **Built the same day** (`CANDIDATES` 40 -> 67 per 10 cards): live, 183 candidates asked after the age gate (19 left out of 27 compared with their affair): the call of the choice 11.5-12.3k -> 18.2k tokens in, the age gate (now 2 calls) 5.2k -> 9.5k in, about **+12k tokens (+3% of a briefing)**, 298 s (243-274 s before); the briefing was 25 cards after 3 of another sport, 4 refused, 1 sent and 2 unreadable were left out | 12.11.2026 |
| **Cards of another sport** left out (`sport-check.js`): the profile's sports from the AI, the sport and the quoted words of each card, the code believes the words | 583 cards of the 25 saved briefings of 3 football profiles since 4.11, and a live briefing | 5 left out, **all of another sport** (ice hockey, basketball, rugby league, rugby union, cricket), none of football; the 3 basketball cards of the live briefing found (with reasoning; the ABA league was football 3 of 3 without). A sentence on the sport in the prompt of the choice: the two cards stayed chosen 5 of 5 | 12.11.2026 |

## Duplicates

A friend of the user keeps meeting "doublons" (the user, 12.11.2026). Measured on the 47 ready briefings saved since 25.10.2026 (990 cards of 3 profiles),
every pair of cards whose vectors (bge-m3, title and first 60 words) were at 0.72 or more, every pair sharing a story or an article, and a sample of 40
pairs from 0.64 to 0.72, judged **SAME / DEVELOPMENT / DIFFERENT** by one AI judge (324 pairs), then the 112 pairs that judge called SAME (or DEVELOPMENT with
a vector at 0.85+) by a second one. A pair on which they split counts as DEVELOPMENT (the doubt hides no news). `bench/dup-eval.mjs`. A duplicate whose cards are
unlike in the vectors (under 0.64) was not looked for: the figures are a floor.

| Measure | Sample | Result | Date |
|---|---|---|---|
| **Inside a briefing**: two cards telling the same news | 47 briefings, 990 cards | **16 pairs in 12 briefings (26%)**; nothing shared by story or article but 3 old pairs. None of the 47 holds a card folded by `card-merge.js` (no `joinedCards`). The code was already on the machine that stays on in the tree of the deploy before 12.11.2026 (`server.old` holds `card-merge.js` and the call in `briefing-service.js`; the day of the first deploy is not known), yet the 10 briefings made since 10.11 have no fold, while the same function replayed on the saved cards of the briefing 1208 (a true pair) folds it **3 times of 3, in 15 to 22 s**. In production it did not run or failed without a trace; the logs of the old container are gone (container made again 12.11.2026 13:37). **Control in the production container the same evening** (after the deploy of 143f069, `docker exec`, the code and the environment of the API, nothing saved): `sameNewsGroups` on the saved cards of the briefing 1208 gives 2 groups both readers agree on, in 29 s; three whole briefings written at once as at the scheduled hour (profiles 7, 137, 980, 30 cards): both readers answered in 15, 32 and 33 s, no error, one fold (profile 7: 1 group by each reader, agreed), none for the two others (one reader gave a group, the other none). So the step runs and answers in production now under the load of three briefings; why the 10 saved briefings of 10 to 12.11 hold no fold stays unknown (with one fold in 3 briefings, 10 briefings without one happen 1 time in 20). The logs of the scheduled briefings of 13.11 will say | 12.11.2026 |
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
| **Sent more than 48 h before** (up to 11 days): 106 pairs by the vectors of the cards, one judge | 21 the same news (15 at 48-96 h, 5 at 4-7 days, 1 later); the look of gemma with reasoning finds 4 | 0 of 85 | 12.11.2026 |
| Candidates for those old cards: the centroid of their stories against the cards of today (from 0.70 / 0.75 / 0.85) | 18 / 13 / 9 of the 21 | 7.2 / 5.0 / 2.2 cards a briefing to look at | 12.11.2026 |

The look pair by pair is stricter than the two judges (they called SAME some pairs where a card adds a detail): it is the safe side for a rule that must not hide an evolution.

**News told late** (the user, 12.11.2026: a news of a week ago taken up by another paper a week later). The age gate (`old-news.js`) asks the AI only about a story whose own story holds news
from before the window; a news told after more than 48 h of silence starts a new story (the grouping joins a news to the stories of the last 48 h), so it has none, and the benches of
the gate drew their cards among the ones whose first news was older than the window: this case was never measured. 60 cards really delivered (the saved briefings since 10.11.2026, drawn at random,
`bench/late-news.mjs`), the earlier coverage taken from each place, one blind judge on the titles, then the real prompt and model of the gate run on it:

| Measure | Result | Date |
|---|---|---|
| Cards delivered that tell a fact already told before the window | **8 of 60 (13%)**, 4 UNSURE; for 4 of the 8 the own story has no earlier news; an affair or a close story holds it for 7 of 8 | 12.11.2026 |
| The age gate as built (the own story only) on these cards | asked 6 cards, flags **0 of 8** old, 0 of 48 new | 12.11.2026 |
| ... adding the affair (thread) to the own story | asked 19, flags **5 of 8** old, **2 of 48** new (own else affair: 4 and 2) | 12.11.2026 |
| ... adding the close stories of the 14 days before (the vectors) | asked 60, flags 7 of 8 old, **5 of 48** new; the close stories alone 6 and 9. A scan of the stories of 14 days costs 6 to 9.5 s a card on the database | 12.11.2026 |
| The query of the affair (the closest earlier news of the stories of the thread) | 4 ms the median, 26 ms the slowest, 40 cards | 12.11.2026 |
| **Second sample**, 60 other cards of the same briefings (not used to choose the variant), two blind judges | 11 of 60 (18%) tell a fact told before, 2 UNSURE; the own story holds the earlier news for 6 of the 11, the affair for 5, the close stories for 9; own story empty for 4 | 12.11.2026 |
| **Built** (`notOldNews` + `StoryModel.earlierInAffair`, the real function and queries, each variant run twice): first sample, own story only / affairs with no floor / affairs with the floor 0.75 | flags 0 / 5 / 4 of 8 old, 1 / 3 / 1-2 of 48 new | 12.11.2026 |
| ... second sample (held out), same three | flags 3 / 4 / 4 of 11 old, 0 / 0 / 0 of 47 new | 12.11.2026 |
| ... both samples (120 cards: 19 old, 95 new, 6 unsure) | own only **3 of 19 old (16%)**, 1 of 95 new left out; with the affairs and the floor **8 of 19 (42%)**, 1-2 of 95 (1-2%); with no floor 9 of 19 (47%), 3 of 95 (3%) | 12.11.2026 |
| Live, an unsaved briefing of profile 7 (30 cards, 114 candidates): no affairs / affairs with no floor / affairs with the floor 0.75 | 7 / 9 / 7 stories left out; the call of the gate 3.3k / 8.0k / 6.1k tokens (+2.8k with the floor, 0.7% of a briefing); with no floor 2 of the 5 stories left out on the affair only were another fact of the same topic (0.70 and 0.73), which led to the floor | 12.11.2026 |
| The query of the affair on the production database, for the stories of the 10 saved briefings (10 to 30 stories) | 8 to 221 ms a call; 120 stories in one call 14 ms. Every story has a thread (a story alone in it gives nothing) | 12.11.2026 |

Titles only, 120 cards in two samples (the first by one judge, the variant was chosen on it; the second by two blind judges, drawn after): 19 old ones is a small number (16%, from 10% to 23%), the
second sample alone gives +1 old one of 11 (the first +4 or +5 of 8), and the replays of the gate on cards that were delivered do not say whether the gate ran in
production when they were made. The AI of the gate gives the same answer twice for almost every card (1 card of 120 differs between two runs of a variant). The floor of 0.75 was set from the first sample
and from a live briefing (below), before the second one was judged: it took away 1 or 2 wrong drops of the first and nothing in the second.

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
| **FIFA map**: an association coloured on a candidate (declared and probable) | 96.7% on the half used to tune it, 88.2% on the half kept sealed, 93.9% over both: the wrong colour is 3.3%, 11.8% and 6.1% | 86.6% of the positions of the gold set found (dev, production code); 85.7% sealed | 308 passages of 4 candidates, 3 labellers; 149 to tune, 151 sealed (35 positions) | 12.11.2026 |
| **FIFA map**: coloured only when declared by both models | 95.7% dev, 100% sealed (0 of 17), 96.8% over both (2 of 63) | 66% dev, 49% sealed | the same set | 12.11.2026 |
| Cost of the steps | names check about 1,500 tokens; contested about 300 tokens a card; official source about 900 tokens a card; countries reading about 170 tokens a card; per-card analysis about 0.08 dollar a briefing; neutral titles about 21,000 tokens | 2026 |

## The FIFA map: the position of an association on a candidate

The page "The FIFA presidency" ([the feature](../briefing/fifa-map/README.md)) colours an association when the news say, in a sentence that names it and the
candidate, that it backs or opposes him. **A wrong colour** is an association coloured while the gold set says it should not be, or not on this side:
a wrong association (the "JFA" of Jordan read as Japan), a sentence that is not about the election, a position that was only uncertain (a headline saying
"UEFA will support X" with nobody speaking). It is the error that costs, so it is the number minimised; the recall (the positions found) comes second.

**The set.** The census of the 30 days to 12.11.2026 for Infantino, Tashima, Wenger and Vega: 1 722 sentences that name the person and a member; kept every
sentence of an association and the sentences of a confederation with a word of support or opposition, at most 15 a group (association x person, chosen to differ
in media, language, week and wording): **308 passages**, split in two halves by group so that near copies never fall on both sides: 149 to tune the
pipeline on ("dev"), 151 sealed, read once at the end ("test"). Labelled by three independent labellers who did not see any model (two Claude, one
deepseek-v4-pro): agreement on the status 77 to 87% (Cohen's kappa 0.65 to 0.81), on the side for or against 82 to 92%, on declared or probable among the
positions both call established 76 to 94%. 222 passages had the three agree, 38 two of three, 48 were settled by the user's rules and by hand (Claude's
reading, to be disputed): criticism of the conduct of the FIFA president by the head of an association counts as a position against; a headline or a journalist
saying that an association supports someone, with nobody speaking, is only uncertain. The gold: 108 established (71 declared, 37 probable), 127 uncertain,
73 discarded; 8 sentences repeated in several stories are counted once.

**The chain** (`services/utils/fifa-reading.js`): the code shows the association; `gemma4:31b` reads with the guide and the code decides the status from its closed
words; what would colour is read again by `deepseek-v4-pro` (thinking): the same side is needed, "declared" only if both say declared.

| Variant | Shown as established | Wrong colour | Positions found | Half |
|---|---|---|---|---|
| The reading of 10.11.2026 (`stance.js`, no "uncertain") | 105 / 67 | 42.9% / 49.3% | 98% / 97% | dev / test |
| The guide, the status by the code (gemma) | 75 | 12.0% (9) | 98% | dev |
| + the association by the code | 73 to 76 | 10 to 13% | 98% | dev |
| + the quote checked by the code | 77 | 14.3% | 98% | dev |
| The same read three times, all alike | 75 | 13.3% | 97% | dev |
| + a second model (deepseek), level of both | 64 | 3.1% (2 of 64; 95% interval 0.9 to 10.7%) | 92.5% | dev |
| The same, the production code | 60 | 3.3% (2 of 60) | 86.6% | dev |
| gemma + the association by the code | 47 | 29.8% (14 of 47; 18.7 to 44.0%) | 94.3% | **sealed** |
| **gemma + deepseek, level of both** | **34** | **11.8% (4 of 34; 4.7 to 26.6%)** | **85.7%** | **sealed** |
| the same, only the declared | 17 | 0% (0 of 17; 0 to 18.4%) | 49% | sealed |
| the same, only the declared | 46 | 4.3% (2 of 46) | 66% | dev |

Never an error of side (for instead of against) in any variant. The same model read three times makes the same errors (13%, as with one reading); only a second
model of another family removes them. The four wrong colours of the sealed half: a thank-you of the South African association to FIFA taken for a support, a
headline on a court ruling taken for a position against, a criticism "of last month" of the AFC taken as current when it had just changed sides, and a request
of explanations by UEFA that the gold calls uncertain (a point of the labelling, not of the model). The positions lost are mostly passages where deepseek,
stricter, did not confirm. Cost of a first reading of a candidate, measured on the real passages of the 30 days to 12.11.2026: Infantino 684 passages read (754 found, 70 left out by the code),
Tashima 128, Wenger 49, Vega 18. A passage costs about 2 800 tokens in and 150 out for gemma, and about 2 700 in and 1 000 out (thinking) for deepseek on the 45% that
would colour: 4 600 tokens on average. So about 3 million tokens (about 1.5 dollars of credits: gemma 0.14 and 0.40 dollar per million tokens in and out, deepseek about
1.2 dollars blended) for Infantino, 0.5 million (0.3 dollar) for Tashima, 0.2 and 0.07 million for the other two; about 57 passages a day for the four, about 4 dollars a month;
the weekly audit about 0.1 million tokens. The reading of 10.11.2026 (775 tokens a passage) was 4 times lighter and 40% wrong on the sealed half.

**What it does not say.** The aim was 2% of wrong colours with an upper bound of 5%: **not reached**, and with this volume it cannot be shown (with no error
in 60 positions shown the upper bound is 6%). Over the two halves the chain colours 6 of 98 wrongly (6.1%; 2.8 to 12.7%); only the declared, 2 of 63 (3.2%).
The dev half was used to tune the prompt and the rules, so its 3% is optimistic; the sealed half has 35 positions, mostly of Jordan, Denmark and France, so its 11.8% rests on
4 errors. The gold is labelled by models and by the user's rules, not by an independent human reading, and the 48 hard passages were decided by Claude on the
user's rules. Not measured: other languages than the ones of the 30 days, other candidates than the four, the aggregation of the signals (the reversals) beyond
the unit tests, the vote of the readers, and the 18 associations that a friend's site marks (13 of the 18 have no sentence behind them, the other 5 are dated
April to May 2026, out of the 30 days kept). The page's default is `FIFA_COLOUR=established` (the user's choice, the probable ones apart in the sheet);
`declared` is the safer setting, `off` colours nothing. A weekly audit of the positions shown is made by the server (30 established signals read again by a third model, `gpt-oss:120b`, and the votes of the readers against
the news, kept in `fifa_audits`): it is a live agreement, not a measure of the truth.

**The candidates the news name** (12.11.2026, `bench/fifa/discover.mjs`, `scripts/fifa-discover.js`): the words alone (FIFA, a president word, a candidacy word in one sentence, a person the
tagger linked to Wikidata) find 25 persons in the 30 days of news: the real candidates (Tashima 88 media, Wenger 71, Vega 14, Beckham 13) and also Blatter (15 media, attacking
the president), a Nigerian presidential candidate (5 media), Macron (urging Wenger), so a count of media is not enough and the map adds nobody without two models of two families saying it.
First run of the judgment, dry, on the 14 days: 5 persons judged, 2 added by the rule (Wenger "rumoured" by both, Vega "declared" by both; Tashima and the president in office were already on
the map) and 3 refused (Blatter, Obi, Macron: both models said no), which is right for the 5, **on 5 persons only: it shows the rule works, it is not a precision**. 7 calls, 4 400 tokens.
Not measured: other weeks, other languages than those of the 30 days, the status (declared or rumoured) against the truth. The source a reader joins to a choice (a link) is read by the same chain
as the news and only informs; read on 4 real pages (5 tried, 1 not readable): 1 said it ("CAF supports Infantino"), 3 unclear (the page does not name the association and the candidate in one
sentence), a count too small to give a rate. The same page added with no candidate (read for the four candidates of the map): on 5 real pages, 1 gave a reading (CAF: for the president in
office, declared), 3 gave no passage (the association is not named with a candidate in one sentence, or by its acronym only), 1 was not readable. A page added on its own now gives signals like a news (they count for the position): the chain is the one measured on the news, but **no wrong-colour rate was measured for
pages a reader pastes**; they are limited to 20 a day for each reader, tied to their author, and taken off with the source.

**The summary of a sheet** (13.11.2026): the part the code builds holds no text written by an AI, so it has no error of meaning, only the errors of the positions it is made of. The part the AI writes on request is
checked by the code (every claim cites facts that exist, no figure outside them) but **no rate of wrong claims was measured**; first run, on the sheet of France (7 facts): 3 claims written, 3 kept, all of them what the facts say
(583 tokens in, 117 out). The check cannot catch a wrong meaning that uses the right figures, and an earlier measure of AI summaries of the news found a meaning error in about one card in ten: the summary is marked as written by the AI.

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
node --env-file=.env bench/fifa/census.mjs "Gianni Infantino" infantino 30   # the FIFA map: the census, then pool.mjs, labels.mjs batches, label-model.mjs,
node bench/fifa/adjudicate.mjs                               # the gold set, then run.mjs L5 dev|test (the variants), P is the code of the server
node --env-file=.env bench/dup-eval.mjs build                # duplicates: the saved briefings; then vectors, pairs, (judges), score, replay, cross, crossScore
pnpm run regression                                          # the corpus of regression, offline
pnpm run regression:live                                     # and with the real model
```
