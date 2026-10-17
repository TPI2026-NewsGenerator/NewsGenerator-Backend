# Accounts > Login and session

The reader signs in with their username and password and stays signed in for a week while they use the
site. The session is a JSON Web Token kept in a cookie the page cannot read: the page asks the server who
is signed in, and whether they are an administrator. Signing out clears the cookie, the last search kept
in the browser and the profile chosen.

## Where

- Client: `client/src/pages/Login.jsx` (`LoginPage`, route `/login`), `client/src/features/login/api/loginApi.js`
  (`LoginApi.authUser`), `client/src/features/auth/AuthContext.jsx` (`AuthProvider`: `refresh`, `forget`),
  `client/src/features/auth/useAuth.js` (`logout`, `expired`).
- API: `POST /api/login` (`routes/login-router.js`), `GET /api/session` and `DELETE /api/session`
  (`routes/session-router.js`).

## How it works

- `POST /login` goes through `rateLimit` first: 10 tries per address in 15 minutes, then 429
  `{error, retryAfter}` (`services/utils/rate-limit.js`, counted in memory; `app.js` trusts the address
  Caddy and the Cloudflare tunnel forward). `LoginController.authUser` answers 400 when the username or
  the password is missing or not a string.
- `LoginService.authUser` reads the user by username whatever its case (`LoginModel.getUserByUsername`,
  table `users`, `mode: 'insensitive'`; the account of the exact name first, should two older ones differ
  only by their case): usernames are unique whatever their case and Settings lets a reader change only its
  case, so "Fabian" signs in as "fabian" (an exact match until 17.10.2026). It then checks the password with bcrypt (`services/utils/pwd-hasher.js`, cost 12). An unknown username is checked
  against `NO_ACCOUNT`, a bcrypt hash no password matches: the answer is the same 401 "Invalid username or
  password..." and takes as long, so the login never tells which usernames exist.
- `generateAccessToken({id, username, email, role})` signs the token with `ACCESS_TOKEN_SECRET`, valid 7
  days (`SESSION_DAYS`). `startSession` puts it in the cookie `session`: HttpOnly, `SameSite=Strict`, path
  `/api`, Secure when the request came through https. The answer is `{id_user}` only, never the token.
- The client then calls `GET /session` (`AuthProvider.refresh`). It answers `{id, username, email, role,
  admin}`: the username and email read now in the database (`UserModel.email`), so a change made by an
  administrator shows at once, and `admin` from `isAdmin` (`services/utils/admin.js`): the role `Admin` read
  in `users` + `roles` at each request, never taken from the token.
- Every protected route runs `authenticateToken` (`services/utils/jwt.js`): no cookie, a bad signature or an
  expired token answer 403 "Forbidden, invalid or expired token... Please try to log in". It also refuses a
  token issued before `users.password_changed_at` (or of an account gone): `passwordChangedAt` reads it once
  per account and keeps it in memory (`services/utils/password-changes.js`). If that check fails, 503.
- A token older than 24 h (`RENEW_SECONDS`) is replaced by a new one of 7 days on the way: a reader who
  comes back within a week stays signed in.
- After it, `activeProfile` picks the profile of the request from the header `X-Profile` (one of the
  user's, else their first), and `adminOnly(...)` answers 403 to a reader who is not an administrator
  (the e-mail of the briefing, its pictures, a news added by its link).
- On the client, `useAuth().expired(data)` sends the reader to the login when an answer says "Forbidden,
  invalid or expired". `forget()` sets the user to null, removes the kept search (`forgetSearch`) and the
  active profile, then calls `DELETE /session`, which clears the cookie (`endSession`, 204).
- The login link to `/register` is shown only when `GET /profile/options` says `signup: true`
  (`SIGNUP_OPEN=1`, see [Signup](../signup/README.md)).

## Diagrams

- [Class diagram](accounts-login-and-session-class.png) ([source](accounts-login-and-session-class.puml))
- [Sequence diagram](accounts-login-and-session-sequence.png) ([source](accounts-login-and-session-sequence.puml))
- Feature overview: [01-accounts](../01-accounts.png); the sprint-1 login sequence, in French,
  [login-sequence-diagram](../login-sequence-diagram.png) (it still
  shows a 404 for an unknown username: the code answers the same 401 as a wrong password).
- Client side: `client/docs/accounts/` (`client-01-accounts`, the login and logout sequences).

## See also

- [Signup](../signup/README.md): the account and its first profile, signed in at once.
- [Settings](../settings/README.md): a new password ends the sessions of the other devices.
- [Accounts](../README.md)
