# Accounts > Signup

A reader creates their account and their first profile in one step: a username, an email, a password,
their language and the profile text the AI helped them write. The profile is read by the AI before the
account exists, so a text in which the AI finds no interest leaves no account behind. Once created, the
reader is signed in and lands on their profile while the sources of their briefing are being found.
Signup is closed unless the server is started with `SIGNUP_OPEN=1`.

## Where

- Client: `client/src/pages/Signup.jsx` (`SignupPage`, route `/register`), with `ProfileFunnel`
  (`client/src/features/profiles/ProfileFunnel.jsx`) for the profile text, `LoginApi.register`
  (`client/src/features/login/api/loginApi.js`) and `AuthProvider.refresh` (`client/src/features/auth/AuthContext.jsx`).
- API: `POST /api/signup` (`routes/signup-router.js`, `controllers/signup-controller.js`,
  `services/signup-service.js`); `GET /api/profile/options` says whether signup is open (`signup`).

## How it works

- The page asks `GET /profile/options`; with `signup: false` it only says "Account creation is closed."
  The login page shows its "Sign up" link only when it is `true`.
- The page checks the same rules as the server before anything is sent, and refuses to send while the
  questions of the AI are not answered (the funnel, see [Profile > AI questions](../../profile/ai-questions/README.md)).
- `signupRouter` runs `whileOpen` (403 "Account creation is closed." unless `SIGNUP_OPEN=1`,
  `signupOpen()` in `services/utils/account-rules.js`), then `rateLimit`: 5 accounts per address and hour.
- `SignupService.register` checks the trimmed fields (`isUsername`: 3 to 30 letters, digits, dots, dashes
  or underscores; `isEmail`: one address, 254 characters at most, no comma, semicolon or bracket;
  `isPassword`: 10 characters to 72 bytes, what bcrypt reads), 400 with the rule.
- `UserModel.taken` looks for the name or the email whatever their case: 409 before any call of the AI.
- `ProfileService.prepare({text, language})` (other feature): 20 to 3000 characters, the AI (gemma4:31b)
  splits the text into interests and the embedder gives their vectors; 422 when no interest can be read.
  Nothing is saved yet.
- The account is created with the role `User` (`UserModel.roleId`) and the password hashed by bcrypt,
  cost 12 (`hashWithSalt`). Two signups racing for one name are stopped by the unique indexes
  `u_users_username_ci` and `u_users_email_ci` on `lower(...)` (`db/add_signup.sql`): 409 (`isTaken`,
  Prisma `P2002`).
- `ProfileService.store(userId, null, prepared)` saves the profile and its interests and starts the
  discovery of its sources in background. If it fails, the account is deleted again
  (`UserModel.delete`, cascade), so the name is free for the next try.
- The token is made as at the login and set in the cookie `session` (`startSession`); the answer is
  201 `{id_user}`. An error of the server (500) is answered with a fixed message, "Your account could
  not be created right now, try again in a few minutes.": anyone can call this route, and the real error
  (the address of the embedder) stays in the log.
- The page calls `GET /session`, says "Account created. The sources of your briefing are being found: a
  few minutes." and opens `/profile`.

## Measured

- Live test of 29.09.2026 (decision log): the account and its 2 interests in about 5 s; the discovery of
  its sources ran after, in background (971 s on the CPU embedder that day).

## Diagrams

- [Class diagram](accounts-signup-class.png) ([source](accounts-signup-class.puml))
- [Sequence diagram](accounts-signup-sequence.png) ([source](accounts-signup-sequence.puml))
- Feature overview: [01-accounts](../01-accounts.png), and [20-signup-sequence](../20-signup-sequence.png),
  the whole signup with the questions of the AI and the profile.

## See also

- [Login and session](../login-and-session/README.md): the cookie, `GET /session`.
- [Settings](../settings/README.md): the same rules for a new name, email or password.
- [Profile > AI questions](../../profile/ai-questions/README.md): the funnel that writes the profile text.
- [Sources > Discovery](../../sources/discovery/README.md): the sources found for the new profile.
