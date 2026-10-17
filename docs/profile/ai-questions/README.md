# Profile > AI questions

The reader does not face an empty field. They write a few words ("Le tennis."), the AI asks up to three
rounds of questions with choices to tick and room for their own words, then writes the profile in the
first person from what they ticked and wrote. Nothing is saved here: the text goes into the field of the
page, the reader reads it, changes it, and saves it like a profile written by hand.

## Where

- Client: `client/src/features/profiles/ProfileFunnel.jsx` (`PROFILE_FUNNEL`), used by
  `client/src/pages/Profile.jsx` (the profile and `NewProfile`) and `client/src/pages/Signup.jsx`;
  `ProfileApi.funnelQuestions` / `funnelText` in `client/src/features/briefing/api/briefingApi.js`.
- API: `POST /api/profile/funnel/questions` `{start, rounds, language}` → `{enough, questions, maxRounds}`,
  then `POST /api/profile/funnel/text` `{start, rounds, language}` → `{text}`
  (`routes/profile-router.js`, `controllers/profile-controller.js`).

## How it works

- **Access** (`profile-router.js`): `funnelAccess` lets the calls through without an account while
  accounts can be made (`signupOpen()`, `SIGNUP_OPEN=1`), else asks for a session (403 without one).
  `funnelLimit`: 40 calls an hour per address, shared with the questions of the projects (429 with
  `retryAfter`).
- **Checked** (`ProfileService.funnelOf`, `services/profile-service.js`): the start is 3 to 300 characters
  (`MIN_START`, `MAX_START`), the language one of `FeedService.languages()` (else 400). The rounds the page
  sends back are cleaned by `cleanRounds` (`services/utils/profile-funnel.js`): 3 rounds, 4 questions,
  8 choices of 80 characters, 400 characters of own words at most, and a ticked choice must be one of the
  choices sent.
- **Questions** (`nextQuestions`): after 3 rounds (`MAX_ROUNDS`) the AI is not asked. Else one call of
  `ollamaJson(questionsPrompt)` (gemma4:31b, thinking not asked, Gemini when Ollama fails, `services/utils/ollama.js`).
  The prompt asks for 2 to 4 questions of 4 to 8 non-exclusive choices on what is still unclear: the
  subjects, which news of them, how far, why, which count most, what the reader refuses. The first round
  always asks for other subjects; the last one at the latest asks what the reader refuses and, with two
  subjects or more, which ones are followed from afar.
- **Shape checked** (`normalizeQuestions`): 4 questions and 8 distinct choices at most. The AI's `enough`
  is ignored at the first round. A question sharing 2 words and three quarters of its words with one the
  reader passed is left out (`askedAgain`): the AI asked one again in the same words. No question left:
  `enough: true`, and the page goes straight to the writing.
- **Writing** (`writeProfile`, `writePrompt`): one more call. The profile in the first person, in the
  reader's language, everything ticked and written and nothing else, what counts most first, what the
  reader refuses last; a subject is "de plus loin" only when the reader said so. Cut at 3000 characters.
- **Too little**: no round and a start under 20 characters, or a text under 20 characters (`MIN_TEXT`):
  422 "tick or write a little more".
- **Failure**: an answer that is no JSON is a 502 (`ollamaJson`); the page shows the error and the
  reader can try again. The funnel holds its state in the page only.
- **After**: the text is saved by `PUT /profile`, `POST /profile/profiles` or the signup, and only then
  split into interests (see [Interests](../interests/README.md)).

## Measured

- With the AI playing 5 real readers who answer only what is asked (`bench/profile-funnel.mjs`,
  9.10.2026), the interests of the profile written find this share of the news of 48 hours the interests
  of the reader's own text find: UEFA referee 57% (the start alone 11%), tennis 32% (0%), astronomy 34%
  (1%), Pokémon cards 33% (34%), computer scientist 29% (10%) — `server/README.md`, "The briefing".
  6 to 8 questions, 1 to 4 s each call.
- The question "which subjects do you follow from afar" (`bench/profile-importance.mjs`, 3 runs each):
  9 of 9 subjects followed from afar got the weight 0.85, 0 of 6 before; no false one.

## Diagrams

- [Class diagram](profile-ai-questions-class.png) ([source](profile-ai-questions-class.puml))
- [Sequence diagram](profile-ai-questions-sequence.png) ([source](profile-ai-questions-sequence.puml))
- Feature overview: [06-profile](../06-profile.png), [25-profile-sequence](../25-profile-sequence.png)

## See also

- [Interests](../interests/README.md): what happens to the text once saved
- [Projects](../projects/README.md): the same funnel, on a project
- [Several profiles](../several-profiles/README.md): `NewProfile` starts with the funnel
- [Accounts > Signup](../../accounts/signup/README.md): the funnel before the account
