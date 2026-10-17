# Profile > Several profiles

A reader has one profile; an administrator can have up to 15, each independent ("Work", "Leisure"): its
own text, interests, projects, refusals, sources, trusted sources, briefings, thumbs and what it follows.
The profile read is chosen in the masthead and sent with every request; the server takes it only when it
is one of the reader's.

## Where

- Client: `client/src/features/profiles/ProfileSwitcher.jsx` (in `features/navbar/components/Masthead.jsx`),
  `client/src/features/profiles/activeProfile.js` (the profile chosen, `withProfile` used by every API
  module), `client/src/pages/Profile.jsx` (`NewProfile` on `/profile?new=1`, `created`, `rename`,
  `removeProfile`); `ProfileApi.list`, `create`, `rename`, `remove`.
- API: `GET /api/profile/profiles`, `POST /api/profile/profiles` `{name, text, language}` (201),
  `PATCH /api/profile/profiles/:id` `{name}`, `DELETE /api/profile/profiles/:id`
  (`routes/profile-router.js`, after `authenticateToken`; no `activeProfile`, the id is in the path).
- `services/utils/active-profile.js` (`activeProfile`, `needsProfile`) on the routes of `/profile`,
  `/feeds`, `/briefing` and `/entities`.

## How it works

- **The profile read** (client `activeProfile.js`): kept in `localStorage` under `newsgenerator.profile`
  (for the page only when the storage is refused), sent as the header `X-Profile` by `withProfile`. The
  pages read their data again when it changes (`useActiveProfile`, `useSyncExternalStore`); the switcher
  reads the list again on `profilesChanged()`. A kept id that is no longer one of the reader's is
  dropped (`setActiveProfile(null)`).
- **Server side** (`activeProfile` middleware): `ProfileModel.idsOf(user)`; `req.profileId` is the
  `X-Profile` asked when it is one of them, else the first profile, `null` when the user has none.
  `needsProfile` answers 400 "Write your profile first" on the routes that add a source or a name.
  Every service reads by `profileId`; the user always comes from the session, never from the request.
- **Another profile** (`ProfileService.create`): `isAdmin` first (`services/utils/admin.js`, the role `Admin`
  read in the database at each request) — 403 for the others, whatever the name they wrote (the name was
  checked first until 17.10.2026: a bad name answered 400); then the name is cleaned (1 to 40 characters,
  else 400); `ProfileModel.count` — 400 at 15 (`MAX_PROFILES`); then `prepare` and `store` as for the
  first profile: interests by the AI, vectors, a new `user_profiles` row, the discovery started. The page
  makes it the profile read.
- **The page**: `NewProfile` starts with the AI questions (see [AI questions](../ai-questions/README.md)),
  in the language chosen for the new profile. "New profile" is shown to administrators only, and disabled
  at `limits.profiles`; "Delete this profile" only with two profiles or more.
- **Renamed** (`rename`): `owned(userId, id)` (404 otherwise), `cleanName`.
- **Deleted** (`remove`): `owned`, then 400 when it is the last one ("can be written again, not deleted");
  `ProfileModel.delete` removes the `user_profiles` row, and `ON DELETE CASCADE` (`db/add_profiles.sql`,
  `db/add_projects.sql`) its `profile_interests`, `user_feeds`, `briefings` and `profile_projects`. The
  answer is the list left; the page reads the first one.
- **A reader who is no administrator**: `PUT /profile` writes their first profile when they have none,
  and rewrites it after; the switcher is hidden while they have one profile.

## Measured

Nothing measured: 15 is the user's choice (comment of `MAX_PROFILES`, 8.10.2026), since each profile has
its sources found and its briefings written by the AI.

## Diagrams

- [Class diagram](profile-several-profiles-class.png) ([source](profile-several-profiles-class.puml))
- [Sequence diagram](profile-several-profiles-sequence.png) ([source](profile-several-profiles-sequence.puml))
- Feature overview: [06-profile](../06-profile.png), [25-profile-sequence](../25-profile-sequence.png)

## See also

- [Interests](../interests/README.md): what `prepare` and `store` do
- [AI questions](../ai-questions/README.md): how a new profile's text is written
- [Accounts > Login and session](../../accounts/login-and-session/README.md): the session and the role `admin`
- [Sources](../../sources/README.md): every source belongs to one profile
