# Profile

What a reader wants to read, in their own words. The AI can help write it with a few rounds of questions;
once saved, the AI splits it into at most 6 interests, each with its own bge-m3 vectors, keywords and
Google News searches, and keeps what the reader refuses apart. The interests drive everything after: the
sources found for the profile, the ranking and the choice of the briefing. A profile can hold projects
read for a time, and an administrator can have several profiles, each with its own sources and briefings.

Code: `routes/profile-router.js`, `controllers/profile-controller.js`, `services/profile-service.js`,
`services/utils/profile-ai.js`, `services/utils/profile-funnel.js`, `services/utils/active-profile.js`,
`models/profile-model.js`; client `client/src/pages/Profile.jsx` and `client/src/features/profiles/`.

## Overview diagrams

- [06-profile](06-profile.png) — class diagram of the whole feature ([source](06-profile.puml))
- [25-profile-sequence](25-profile-sequence.png) — written with the AI, saved, another profile chosen
  ([source](25-profile-sequence.puml))
- Client side: [client-03-profiles](../../../client/docs/profile/client-03-profiles.png)

## Sub-features

- [AI questions](ai-questions/README.md) — a few words, up to 3 rounds of questions with choices, then the
  profile written by the AI; nothing saved.
- [Interests](interests/README.md) — the text split by the AI (a second call when a word is missing or an
  interest is too long), refusals kept apart, weights, vectors; an interest corrected or removed.
- [Projects](projects/README.md) — up to 5 projects per profile, written and split the same way, read by
  the briefing until their last day.
- [Several profiles](several-profiles/README.md) — administrators only, 15 at most, the one read sent as
  `X-Profile`; listed, created, renamed, deleted.

The sources of a profile (found, added, trusted, removed) are documented under [Sources](../sources/README.md).
