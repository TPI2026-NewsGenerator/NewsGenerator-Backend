# Profile > Projects

A project is something the reader prepares for a time: a trip, a purchase, a move, a report. It is
written with the AI as a profile is, split into interests, and read by the briefing with the profile's
own interests until its last day. No source is found for it: its news come from the profile's sources
and from the Google News searches of its interests while it runs.

## Where

- Client: `client/src/features/profiles/Projects.jsx` (`Projects`, `Project`, `PROJECT_FUNNEL` given to
  `ProfileFunnel`), in the section "Your projects" (`#projects`) of `client/src/pages/Profile.jsx`;
  `ProfileApi.projectQuestions`, `projectText`, `createProject`, `setProjectEnd`, `removeProject`.
- API (`routes/profile-router.js`, all after `authenticateToken` and `activeProfile`):
  `POST /api/profile/projects/funnel/questions` and `/funnel/text` (also `funnelLimit`),
  `POST /api/profile/projects` `{name, text, endsOn}`, `PATCH /api/profile/projects/:id` `{endsOn}`,
  `DELETE /api/profile/projects/:id`. Every answer but the funnel's is the whole profile.

## How it works

- **The questions** (`ProfileService.projectQuestions`, `services/profile-service.js`): the start is
  checked as a profile's (3 to 300 characters), in the language of the profile (`readerLanguage`), not one
  the page sends. `nextQuestions` gets the profile text (`profileText`) and uses `projectQuestionsPrompt`
  (`services/utils/profile-funnel.js`): questions on the project only, nothing the profile already says,
  never how long it lasts; 3 rounds at most; the last one asks what the reader does not want.
- **The description** (`projectText`): `writeProfile({..., project: true})` with `projectWritePrompt`,
  first person, the project, then the news wanted, then what is not wanted. Under 20 characters: 422.
- **Saved** (`createProject`): name 1 to 40 characters, text 20 to 3000, last day checked by `cleanEnd`
  (`YYYY-MM-DD`, from today to 366 days, or none), 5 projects per profile at most (`MAX_PROJECTS`, 400
  over it). Then `interestsOf` splits the text as a profile's (see [Interests](../interests/README.md)),
  `embed()` gives the vectors, and `ProfileModel.addProject` writes, in one transaction, the row of
  `profile_projects` and the rows of `profile_interests` with `id_project` set. No interest: 422.
- **Read while it runs** (`ends_on IS NULL OR ends_on >= current_date`, `RUNNING_PROJECT` in
  `models/profile-model.js`): `briefingInterests` gives the briefing the interests of the profile and of
  its running projects, each with its project's name; `rank_profile_stories` (`db/add_projects.sql`) ranks
  the stories on all of them; `readerText` (`services/briefing-service.js`) adds each running project's
  name and text to the profile the AI reads to choose and review the cards. `searchesOf` includes the
  Google News searches of running projects, read like feeds.
- **Never** looked for by the discovery (`interestsForDiscovery` and `profileFeedRelevance` read
  `id_project IS NULL` only), and never replaced when the profile is saved again.
- **Ended**: kept and shown "ended on …: no longer read" until its last day is moved
  (`setProjectEnd`, the same `cleanEnd`) or it is deleted (`deleteProject`; its interests go with it,
  `ON DELETE CASCADE`). 0 rows: 404.

## Measured

Nothing yet: the prompts of the projects reuse the rules of the profile's and were not measured on a bench
(comment of `profile-funnel.js` and [the former README](../../archive/readme-features-2026-10-24.md), 13.10.2026).

## Diagrams

- [Class diagram](profile-projects-class.png) ([source](profile-projects-class.puml))
- [Sequence diagram](profile-projects-sequence.png) ([source](profile-projects-sequence.puml))
- Feature overview: [06-profile](../06-profile.png), [25-profile-sequence](../25-profile-sequence.png)

## See also

- [AI questions](../ai-questions/README.md): the same funnel for a profile
- [Interests](../interests/README.md): how a text becomes interests
- [Briefing](../../briefing/README.md): where the projects are read
