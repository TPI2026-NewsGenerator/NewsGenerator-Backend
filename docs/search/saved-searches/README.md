# Search > Saved searches

A reader keeps the form of a search under a title (its words, its language, its categories) and fills
the form again from it later in one click. A saved search loaded and saved again replaces itself, unless
the reader saves it as a new one. The saved searches belong to the account, not to a profile, and are
never run on their own.

## Where

- Client: `client/src/pages/Search.jsx` (`loadSavedSearches`, `handleSaveSearch({asNew})`,
  `applySavedSearch`, `removeSavedSearch`, the dialog "Save search"),
  `client/src/features/custom-search/api/customSearchApi.js` (`CustomSearchApi`).
- API: `GET /api/customsearch`, `POST /api/customsearch`, `DELETE /api/customsearch`
  (`routes/customsearch-router.js`, `controllers/customsearch-controller.js`,
  `services/customsearch-service.js`, `models/customsearch-model.js`).

## How it works

- Every route runs `authenticateToken`; the user is always the one of the session (`req.user.id`), never
  one named in the request.
- `GET` reads the user with their `custom_searches` and the `categories` of each
  (`custom_searches_has_categories`) and answers `[{id, title, keyword, language, timeframe, category}]`,
  the category names in lower case. The page lists them beside the form.
- Choosing one fills the form with its keyword, language and categories; the timeframe chosen on the
  page stays (the column `timeframe` is written `'Weekly'` at every insert and never read by the page).
- `POST {id?, title, keyword, language, category}`: the controller wants all four fields (400). With an
  `id`, `updateUserCustomSearch` updates the row `WHERE id AND id_user` and writes its categories again;
  no such row of this user (Prisma `P2025`) answers 404. Without, `postUserCustomSearch` inserts it with its
  categories, connected by `category_name`. A title the user already has (unique index
  `u_custom_searches` on `id_user, title`, `P2002`) answers 409 "You already have a search with this title...".
  The page shows that message and keeps the form open (`CustomSearchApi.postUserCustomSearch` answers
  `{error, status}` when not saved); until 17.10.2026 it showed only "Error while creating X...".
- After a save the page reads the list again and keeps the id in the form: saving again replaces it;
  "Save as a new search" sends no id.
- `DELETE {id}` removes the categories and the search in one transaction, the search only `WHERE id AND
  id_user`: a search of another user (or already gone) answers 404 and nothing is deleted (the
  transaction is rolled back). Answer `{deleted: true}`.
- The last search itself (form, news, key passages, translations) is kept in the browser for a day,
  apart from the saved ones (`client/src/features/search/keptSearch.js`).

## Diagrams

- [Class diagram 02-saved-searches](02-saved-searches.png) ([source](02-saved-searches.puml)): the
  modules of the server.
- [Sequence diagram](search-saved-searches-sequence.png) ([source](search-saved-searches-sequence.puml)):
  list, save or replace, delete, as the code answers today.
- The sequences of sprint 1, in French, one per call:
  [get](search-history-get-diagram.png) ([source](search-history-get-diagram.puml)),
  [save](search-history-save-diagram.png) ([source](search-history-save-diagram.puml)),
  [edit](search-history-edit-diagram.png) ([source](search-history-edit-diagram.puml)),
  [delete](search-history-delete-diagram.png) ([source](search-history-delete-diagram.puml)).
  The save and edit ones show the 409 of a title already used.
- Client side: `client/docs/search/saved-searches/`.
- Feature overview: [03-search](../03-search.png), [21-search-sequence](../21-search-sequence.png).

## See also

- [Keywords](../keywords/README.md) and [Search by meaning](../search-by-meaning/README.md): what runs
  when the form is searched.
- [Login and session](../../accounts/login-and-session/README.md): the session the routes check.
