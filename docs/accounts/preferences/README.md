# Accounts > Preferences

How the page looks for a reader (the layout of the e-mail editor, the blocks ticked for the e-mail and for the page,
the way a card is read, the size of the next briefing, the news per name followed) is kept on the
account, so that a phone and a laptop show the same. Before (06.11.2026) each browser kept its own in
`localStorage`; they are still kept there, so the page answers at once and works with no session or no
network, and the account catches up.

## Where

- Client: `client/src/features/preferences/` (`preferences.js`, the store and the synchronisation;
  `usePreference.js`, the hook; `preferencesApi.js`, the two calls; `registered.js`, which loads every
  preference), read by `features/auth/AuthContext.jsx` (`startPreferences` once the session tells who the
  reader is, `endPreferences` when they sign out). The six preferences are defined in
  `features/briefing/` (`mailEditorLayout.js`, `blockPresets.js`, `formats.js`, `sizes.js`, `windows.js`),
  each with its public helpers (`keptLayout` / `keepLayout`, `useBlocks`, ...).
- API: `GET /api/account/preferences` and `PUT /api/account/preferences` (`routes/account-router.js`,
  `controllers/account-controller.js`, `services/account-service.js`, rules in
  `services/utils/preferences.js`).
- Database: `users.preferences`, a `jsonb NOT NULL DEFAULT '{}'` (`db/add_user_preferences.sql`).

| Key on the account | Value | Kept in the browser under |
|---|---|---|
| `layout` | `frames` or `matrix`: the editor of the e-mail | `newsgenerator.mail-editor` |
| `mailBlocks` | a list of blocks: what the editor of the e-mail opens with, and so what the e-mail has for every story that has them (the user, 10.11.2026: one mode instead of the three presets) | `newsgenerator.mail-blocks` |
| `pageBlocks` | the same, for the cards of the page of the briefing | `newsgenerator.page-blocks` |
| `mailPresets`, `pagePresets`, `show` | **before 10.11.2026**: `{short, standard, everything}`, each a list of blocks, and the preset the page showed. No page writes them any more, they are still accepted and kept: a reader who set them and has not ticked a list yet keeps what they had (the page's list is the preset it showed, the e-mail's the preset they had changed, `everything` first) | `newsgenerator.mail-presets`, `.page-presets`, `.briefing-show` |
| `format` | `points`, `digest` or `passages`: the way a card is read | `newsgenerator.briefing-format` |
| `aiFirst` | `true` or `false` (true when never set): the cards and the editor of the e-mail start on the AI version of the sentences | `newsgenerator.ai-first` |
| `size` | 10, 20 or 30 (`BRIEFING_SIZES`): the cards of the next briefing | `newsgenerator.briefing-size` |
| `followingNews` | 10 to 100, by 10 (`WATCH_LIMITS`): the news per name followed | `newsgenerator.following-news` |

The blocks of a list are `picture`, `countries`, `media`, `contested`, `official`, `unconfirmed`,
`names`, `analysis`, `angles`, `affair` and `coverage`.

**Stay on the device**, never sent: the theme (`theme`), the profile read (`newsgenerator.profile`) and the
last search (`newsgenerator.search`).

## How it works

- **The server.** `GET` gives `{preferences}`, the keys the reader set (`{}` until one is). `PUT` takes an
  object of the keys to change and gives `{preferences}` as now kept: it is partial, the keys sent are put
  over the ones kept by one SQL statement (`preferences || $1::jsonb`, `UserModel.mergePreferences`), so two
  devices saving two different preferences at once keep both. A list of blocks is replaced as a whole. The
  account is always the one of the session (`req.user.id`), never one named in the request.
- **The rules** (`checkedPreferences`) are a whitelist: a body that is not an object, an empty one, a key
  that is no preference, a value the page does not offer, a block that does not exist or twice in a list (an empty list is allowed: it is a choice),
  a preset that is not `short`, `standard` or `everything` in the old presets, all answer 400 with the rule, and nothing
  is saved (not even the right keys of the same body). A body over 4096 bytes answers 413. An account
  that is gone answers 404, an error of the database 500 with no detail.
- **Limits.** `authenticateToken`, then one counter per account and per route: 60 reads and 200 saves in
  10 minutes (429). The 10 changes in 15 minutes of the username, the email and the password do not apply:
  those ask a password, these do not.
- **The page answers first.** `preference({name, key, fallback, parse, serialize})` makes a preference:
  `kept()` gives the value of the browser, or the one at first, with no call; `keep(value)` writes it in
  the browser, tells every component that reads it (`usePreference`, `useSyncExternalStore`, and the
  `storage` event for another tab), then sends it. A value the page does not offer in the browser is the one
  at first, as before.
- **After the sign-in.** `startPreferences(userId)` reads the account once. For each preference: the
  account has one the page offers, it wins and the browser keeps it from then on; the account has none, what
  the browser kept goes up (this is how what a reader set before 06.11.2026 reaches their account); the
  value of the account is none the page offers, it counts as none. A call that fails changes nothing.
- **Each change goes up after 800 ms** (`SEND_DELAY`): a box ticked five times in a row is one `PUT` with
  the last value of each preference changed, and nothing else. A failed call (network, 4xx, 5xx, an
  expired session) is silent and keeps the value in the browser. The name of a preference not sent yet is
  kept in `newsgenerator.preferences-unsent`, so a change made offline, or a page closed before the call,
  wins over the account at the next sign-in instead of being undone by it.
- **Whose they are.** `newsgenerator.preferences-owner` holds the account the browser's preferences belong to.
  A browser that had none (set before accounts kept them) gives them to the first account that signs in; an
  account that is not the owner finds the defaults and its own preferences from the server, and nothing the
  other reader waited to send goes up under its cookie. Signing out sends what waits at once, while the
  session lasts, and keeps the preferences in the browser: the same reader has them back with no wait.
- **A private window** (storage refused) holds the preferences for the page only, as before for the presets.

## Diagrams

- [Class diagram](accounts-preferences-class.puml) (source only: PlantUML is not rendered yet)
- [Sequence diagram](accounts-preferences-sequence.puml): the sign-in that reads the account, then a change.
- Feature overview: [01-accounts](../01-accounts.png).

## See also

- [Settings](../settings/README.md): the username, the email and the password, with the password of now.
- [Login and session](../login-and-session/README.md): the session the two calls need.
- [Briefing > Email](../../briefing/email/README.md): the blocks and the layout of the editor.
