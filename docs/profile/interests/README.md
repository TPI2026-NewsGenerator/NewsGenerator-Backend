# Profile > Interests

When a profile is saved, the AI splits its text into at most 6 interests, each one a subject with every
precision the reader gave, and each gets its own bge-m3 vectors. The briefing ranks the news on each
interest apart, and the discovery looks for the sources of each. What the reader refuses is kept apart,
never as an interest. The reader can correct an interest, make it secondary or remove it.

## Where

- Client: `client/src/pages/Profile.jsx` — the field "In your own words" (`save`, `changeLanguage`), the
  section "Your interests" (component `Interest`) and "Left out" (the refusals); `ProfileApi.save`,
  `updateInterest`, `deleteInterest` in `client/src/features/briefing/api/briefingApi.js`.
- API: `PUT /api/profile` `{text, language}`, `PATCH /api/profile/interests/:id` `{text}` or `{weight}`,
  `DELETE /api/profile/interests/:id`; all after `authenticateToken` and `activeProfile`
  (`routes/profile-router.js`). Every answer is the whole profile (`ProfileService.get`).
- The signup splits the first profile the same way (`SignupService.register` calls `prepare` then `store`).

## How it works

- **Checked** (`ProfileService.prepare`, `services/profile-service.js`): the text is 20 to 3000 characters
  (`MIN_TEXT`, `MAX_TEXT`), the language one of `FeedService.languages()` (400 otherwise). A reader with no
  profile yet writes their first one with the same `PUT`.
- **First call** (`interestsOf`, `services/utils/profile-ai.js`): `ollamaJson(interestsPrompt)`, gemma4:31b
  (Gemini when Ollama fails). Per interest the AI gives its text (subject, then every precision in the
  reader's words, never their sentences nor what they refuse), a weight (1, or 0.85 for a subject followed
  from afar), 8 to 12 keywords, the languages to search (the reader's, English, the ones of the countries
  of the subject, 4 at most), 2 Google News searches per language, section names and a category.
  `refused`: what the reader does not want.
- **Shape checked** (`normalizeInterests`): 6 interests (`MAX_INTERESTS`), text cut at 500 characters
  (`MAX_INTEREST_TEXT`), weight clamped to 0.5–1, keywords 400 characters, searches only in languages
  Google News has, a category of the list, 4 sections. A refusal still in a text is cut from its
  "sans", "mais je refuse", "except"… (`withoutRefusals`); keywords and searches naming a refusal or a
  past year are left out. Refusals: 6 at most, 200 characters each (`normalizeRefused`).
- **Second call**: when a word of the reader is in no interest nor refusal (`missingWords`, the words of
  how a profile is written aside) or an interest is over 500 characters, the AI gets its answer back with
  what to fix. Its new answer is kept only when it is better on one and not worse on the other; failing,
  the first one stays.
- **No interest**: 422, nothing saved.
- **Vectors** (`withVectors`): `embed()` (`services/utils/embedder.js`) gives each text a dense vector
  (1024) and a sparse one, written as text and cast in SQL. No embedder answering: 503, nothing saved.
- **Saved** (`ProfileModel.save`, one transaction): `user_profiles.text`, `languages`, `refused`; the rows of
  `profile_interests` of the profile itself (`id_project IS NULL`) replaced, those of its projects kept;
  `dense` and `sparse` set by position. Then `DiscoveryService.start` looks for sources in background.
- **Corrected by hand** (`updateInterest`): a new text (1 to 500 characters) is embedded again; a weight
  must be 0.5 to 1 (the page only toggles 1 / 0.85). `deleteInterest` removes one row. Both act only on a
  row of the profile itself (`id_project` null: never an interest of one of its projects, which goes with its
  project; 0 rows: 404) and start no discovery. Until 17.10.2026 they filtered on the profile only, and could
  change or delete an interest of a project.
- **Read by**: `rank_profile_stories` (`db/add_projects.sql`) scores a story by
  `weight × (dense + sparse_weight × sparse)` per interest; the briefing shares its places among
  interests by weight (`shareOut`); the discovery searches each interest's searches; Google News reads the
  searches as feeds (`ProfileModel.searchesOf`).

## Measured

- One vector per interest, not one for the profile (four profiles, 249 stories judged by hand, comment of
  `services/briefing-service.js` and [the former README](../../archive/readme-features-2026-10-24.md)): 88% relevant cards with one vector per interest,
  95% once the AI chose among the 40 best, 38% with one vector for the whole profile. The average of rugby
  and fashion is football.
- Interests without the reader's sentences and refusals (`bench/split-clean.mjs`): a tennis/AI/Swiss
  politics profile found 23% of the news its own interests find with the sentences and refusals in, 50%
  without the refusals, 80% without the reader's words either.
- 300 characters per interest cut the governance interest of the UEFA profile each time
  (`bench/split-real.mjs`, 9.10.2026), hence 500.
- Asking again when an interest is too long (`bench/split-long.mjs`, 3 runs, 13.10.2026): the news of
  48 h a split by hand finds went from 47–52% to 62–64% (Roberto, 2366 characters) and 48–51% to 64–66%
  (a football profile), no interest cut.

## Diagrams

- [Class diagram](profile-interests-class.png) ([source](profile-interests-class.puml))
- [Sequence diagram](profile-interests-sequence.png) ([source](profile-interests-sequence.puml))
- Feature overview: [06-profile](../06-profile.png), [25-profile-sequence](../25-profile-sequence.png)

## See also

- [AI questions](../ai-questions/README.md): the text written with the AI before it is saved
- [Projects](../projects/README.md): split the same way, kept apart
- [Sources > Discovery](../../sources/discovery/README.md): what `start` does with the interests
