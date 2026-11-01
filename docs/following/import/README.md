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
   that fails (Wikidata asking to wait) stops the loop with the message and "Try again" carries on from the lot that
   failed. Each name is, in this order:
   - `invalid`: not 2 to 60 characters;
   - `known`: already followed, as an item (by one of its names) or as written;
   - `word`: Wikidata has no item for it (the pages of Wikimedia, of a family or given name left aside);
   - `linked`: one item in all, or several and one stands out: in at least 10 Wikipedias and 3 times more than any
     other, **and called with that name** (`dominantOf`: "Kylian Mbappé" among a book and a character, "Paris" the
     capital; not "LFF", the alias of a league of Lithuania far ahead of the others, nor "Real Madrid" when a
     basketball section is close). The Wikipedias of the items of all the doubts of a lot are counted together,
     50 items a call;
   - `choose`: several, none stands out ("Michael Oliver": a referee, an actor, an academic). The items are listed,
     8 at most, the ones called exactly so first.
3. **Review.** The counts, the names to choose (a radio list of each, "None of these: follow it as written" by
   default, a button "Pick the first of each"), the ones linked automatically in a list to check, and the room
   left: past 300 the clubs, people and organisations come first, the others are left out.
4. **Follow** (`importNames`), in one request: the items the database does not know are described (50 a call,
   `describeItems`, in English) and written with their label alone (`addNamed`), then all followed
   (`followMany`) and the words added (`setWatchTerms`). The rows with a label alone are read in full from
   Wikidata afterwards, one after the other (`fillItems`: three calls each, minutes for a list, lost with a
   restart: the item is then read in full when its page is opened). An item Wikidata does not have any more is
   left out (`left.missing`).

## Measured (2.11.2026, real Wikidata)

Ten names in 4 to 7 s. "Gianni Infantino", "Pierluigi Collina", "Vadims Ļašenko" linked; "Kylian Mbappé" and "Paris"
linked as the best known of several; "Michael Oliver", "Real Madrid", "LFF" to choose; a name that is no one's
as written. "Real Madrid" was first linked to a small Argentine club called so, the only item called exactly so:
all the items are now looked at before one is linked.

## See also

- [Names and words](../names-and-words/README.md): the news of the names followed, how 300 are searched.
- [Wikidata items](../wikidata-items/README.md): the items, their names and links.
