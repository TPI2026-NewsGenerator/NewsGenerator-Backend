# Accounts > Settings

The reader changes their username, their email or their password on the Settings page. Each change asks
for the current password, so a session left open on another computer is not enough to take the account.
A new password signs out every other device; the one used keeps its session.

## Where

- Client: `client/src/pages/Settings.jsx` (`SettingsPage`, route `/settings`, three sections "Your
  username", "Your email", "Your password"), `client/src/features/auth/accountApi.js` (`AccountApi`),
  `client/src/features/auth/useAuth.js` (`refresh`, `expired`).
- API: `PUT /api/account/username`, `PUT /api/account/email`, `PUT /api/account/password`
  (`routes/account-router.js`, `controllers/account-controller.js`, `services/account-service.js`).

## How it works

- The page checks the rules first (username 3 to 30 letters, digits, dots, dashes or underscores; one
  email address; a new password of 10 characters at least, typed twice the same) and that the current
  password is written.
- Each route runs `authenticateToken`, then one rate limiter shared by the three routes: 10 changes per
  address in 15 minutes, then 429. The account changed is always the one of the session (`req.user.id`),
  never one named in the request.
- `AccountService` checks the new value against `services/utils/account-rules.js` (400 with the rule),
  then `checkedAccount`: the account with its hash (`UserModel.withPassword`, 404 when it is gone) and
  `verifyPassword` (bcrypt), 401 "Your current password is not this one." with no hint of what is wrong.
- Username and email: the same value again writes nothing; another account using it whatever its case
  answers 409 (`nameTakenByOther`, `emailTakenByOther`, then the unique indexes on `lower(...)` through
  `isTaken`). A reader may change only the case of their own name. The email is also where the briefings
  a reader sends themselves go by default.
- Password: the new one must differ from the current one (400). It is hashed (bcrypt, cost 12) and
  written with `users.password_changed_at` = now, to the second. `notePasswordChange` tells
  `services/utils/password-changes.js` at once, so `authenticateToken` refuses from now on every token
  issued before that second: the other devices get 403 at their next request.
- Every change answers a new token (`generateAccessToken` with the account as it is now, set by
  `startSession`) and `{id, username, email, role}`. The page then calls `GET /session` so the masthead
  shows the new name, and says it in a toast. An error of the server answers 500 "Your account could not
  be changed right now."; a 403 sends the reader to the login (`expired`).
- The role and the e-mail of another reader are not changed here: the role is set in the database, see
  [Login and session](../login-and-session/README.md).

## Diagrams

- [Class diagram](accounts-settings-class.png) ([source](accounts-settings-class.puml))
- [Sequence diagram](accounts-settings-sequence.png) ([source](accounts-settings-sequence.puml)): the new
  password; the username and the email in its last note.
- Feature overview: [01-accounts](../01-accounts.png).

## See also

- [Login and session](../login-and-session/README.md): how a token opened before the last change of password is refused.
- [Signup](../signup/README.md): the same rules for the first name, email and password.
- [Briefing > Email](../../briefing/email/README.md): the account email as the default recipient.
