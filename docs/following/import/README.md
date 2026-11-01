# Following > Import

A list of names to follow, from the first column of an Excel file (the user, 2.11.2026): each name is looked for
in Wikidata, the ones it has one item for are linked to it, the reader chooses among the ones it has several for
and none stands out, and the others are followed as written. A profile follows 300 names in all.

## Where

- Client: `client/src/features/entities/components/ImportNames.jsx` (the button and the dialog, on the page
  `/following`), `client/src/features/entities/importNames.js` (the first column of a sheet, the lots, the plan),
  `EntityApi.importCheck` and `EntityApi.importNames` (`entityApi.js`). The file is read in the browser
  (`readSheet` of `read-excel-file`, `.xlsx`): only the names go to the server.
- API (`routes/entity-router.js`): `POST /api/entities/import/check {names}` (10 names at most) and
  `POST /api/entities/import {qids, words}`; both need a profile, 120 requests per 10 minutes per reader.
- Server: `EntityService.checkNames`, `importNames` (`services/entity-service.js`), `candidatesFor`
  (`services/utils/wikidata.js`), `EntityModel.byQids`, `addNamed`, `followMany`.

## How it works

1. **Read.** The first column of the first sheet, the empty cells left out, each name once whatever its case,
   quotes and commas out. A checkbox says the first row is a title. The dialog shows the count before anything
   is asked of Wikidata.
2. **Look up** (`checkNames`), 10 names a request, the client sending the lots one after the other with a
   progress bar (Wikidata answers a call every 0.4 s whoever asks, 300 names are about two minutes). A request
   ends after 30 s even with names left (`CHECK_BUDGET_MS`): behind the server stand Caddy and the tunnel of
   Cloudflare, which answer with a page of HTML after about 100 s (524); the answer tells the first names, at
   least one, and the client asks the others with the next lot. An answer that is HTML (a restart, a timeout, a
   refusal of the tunnel) is told as such by the client (`readAnswer`: "The server answered 524 with a page, not
   data") and not as "Unexpected token '<'". A request
   that fails does not stop the import (the user, 2.11.2026: a failure on 8 names is certain on 300):
   - **The server answers for the names it told and says how long to wait.** Wikidata asking to wait (429), being
     slow or answering a page that is no JSON stops the search: the answer holds the names looked for so far and
     `retryIn`, the milliseconds to wait (30 s when Wikidata does not say, 2 s to 2 min); a failure on the first
     name is a 502 that carries `retryIn` too. When the Wikipedias of the doubts of a lot cannot be counted, the
     first doubt and the names after it are not answered (the reader would be asked about clear names).
   - **The client carries on by itself** (`withRetry`, `checkNames` of `importNames.js`): after what the server
     asks, and at least 4, 8, 16, 32 then 60 s, it asks the same lot again, for a failure that passes (no network,
     a page, a 5xx, a 408 or a 429, which says `retryAfter`), never for a call the server refuses (400, 403, 404).
     The page says "Wikidata or the server is slow... Carrying on in 24 s by itself, nothing is lost" with the seconds
     counted down; the names told are kept. It gives up after 10 minutes of waiting without an answer, then "Try
     again" carries on from the names that are left. The step of following is asked again the same way (it is
     without harm to ask it twice).
   - **What Wikidata told is kept** 6 hours in memory (`memo.js`: the items a name may be, the Wikipedias of an
     item): a list imported twice, or a lot asked again, does not ask again.
   - Measured (2.11.2026, real code and real Wikidata, a refusal to go faster and a page of HTML added in the
     middle of 40 names): all 40 told, no error and no click, the same results as without failures, 122 s against 24 s.
   Each name is, in this order:
   - `invalid`: not 2 to 60 characters;
   - `known`: already followed, as an item (by one of its names) or as written;
   - `word`: Wikidata has no item for it (the pages of Wikimedia, of a family or given name left aside);
   - `linked`: one item in all, or several and one stands out: in at least 10 Wikipedias and 3 times more than any
     other, **and called with that name** (`dominantOf`: "Kylian Mbappé" among a book and a character, "Paris" the
     capital; not "LFF", the alias of a league of Lithuania far ahead of the others, nor "Real Madrid" when a
     basketball section is close). An item found only by an alias, not called with the name, counts for half its
     Wikipedias against the others: "Pep Guardiola" (95 Wikipedias) was asked about because Néstor Gorosito (49)
     has it as an alias, and 95 is not 3 times 49. The Wikipedias of the items of all the doubts of a lot are
     counted together, 50 items a call. **The theme of the profile settles the doubts that remain** (the user,
     2.11.2026: the profiles are about football, the footballer must be chosen without asking, the description
     under the name says it): the one whose description holds a word of the theme (`themed`: that word, "Michael
     Oliver", "English football referee", for a profile of football) is linked when it is the only one, or the one
     that stands out among those that do; never when another is 3 times better known in Wikipedias (a footballer
     with a namesake of another trade who is far ahead is left to the reader), nor when it is only called so by an
     alias. See *The theme of a profile* below;
   - `choose`: several, none stands out ("Michael Oliver": a referee, an actor, an academic) and none of the theme.
     The items are listed, 8 at most, the ones of the theme first, then the best known in Wikipedias.
3. **Review.** The counts, the names to choose (a radio list of each, "None of these: follow it as written" by
   default, a button "Pick the first of each"), the ones linked automatically in a list to check, and the room
   left: past 300 the clubs, people and organisations come first, the others are left out.
4. **Follow** (`importNames`), in one request: the items the database does not know are described (50 a call,
   `describeItems`, in English) and written with their label alone (`addNamed`), then all followed
   (`followMany`) and the words added (`setWatchTerms`). The rows with a label alone are read in full from
   Wikidata afterwards, one after the other (`fillItems`: three calls each, minutes for a list, lost with a
   restart: the item is then read in full when its page is opened). An item Wikidata does not have any more is
   left out (`left.missing`).

## The theme of a profile

`themeOf` (`profile-theme.js`) takes it from the **keywords** of the interests of the profile (the text of an
interest that has none), no list of subjects written in the code: the words of 5 letters or more, without the
generic ones ("updates", "associations", "national", "team", "european") and without a name of a country, that come
back at least 3 times and in half of the interests (1 at least), 8 at most. Half and not more: Roberto writes
"refereeing" and "UEFA" in his interests and "football" in two of the four (the user, 2.11.2026: he should have
football too). Keywords and not the texts: the texts are prose, in French for Enzo who asks for English
descriptions, so that "arbitrage" came out as his theme and "referee" did not (the user, 2.11.2026), and full of
words that name no subject (with the texts a profile of sailing had "America", from the America's Cup, which holds
for every "American actor"). Enzo gets *football, refereeing, referee*, Chris *football, governance*, Roberto
*referee, football, refereeing*; a profile of tennis, artificial intelligence and Swiss politics gets none (no
word is in two of the three), and the doubts stay the reader's. `holdsTheme` compares it with the description of an item, its words and the words of
the theme taken for one when they start alike, all but 2 letters of the shorter at most left out (*football* and
*footballer* or *footballeur*, *referee* and *refereeing*, *arbitrage* and *arbitre*; not *governance* and
*government*). The description is the one Wikidata gives in the language of the profile, as are its keywords.
The interests are read only when a name is in doubt, and when they cannot be read the doubts are the reader's.
The page shows what was chosen for it: "(chosen among several: it fits your interests, “football”)".

## Measured (2.11.2026, real Wikidata)

For the profile of Enzo (real interests, real Wikidata): "Michael Oliver" and "Anthony Taylor", asked about before
(8 namesakes each), linked to the English football referee; "Daniel Siebert", "Pep Guardiola" and "Marco Rossi"
as before (one stands out). For the profile of tennis, the same two names are still asked about; for Chris,
"John Smith" (8 politicians, a botanist, a rower, none of football) too.

Ten names in 4 to 7 s. "Gianni Infantino", "Pierluigi Collina", "Vadims Ļašenko" linked; "Kylian Mbappé" and "Paris"
linked as the best known of several; "Michael Oliver", "Real Madrid", "LFF" to choose; a name that is no one's
as written. "Real Madrid" was first linked to a small Argentine club called so, the only item called exactly so:
all the items are now looked at before one is linked.

## See also

- [Names and words](../names-and-words/README.md): the news of the names followed, how 300 are searched.
- [Wikidata items](../wikidata-items/README.md): the items, their names and links.
