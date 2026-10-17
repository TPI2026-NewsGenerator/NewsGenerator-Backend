# Accounts

Who reads. A reader has an account (username, email, password, a role `User` or `Admin`) and a session
kept in a cookie the page cannot read. Accounts are made by the readers themselves while the server lets
them (`SIGNUP_OPEN=1`), always with a first profile; the account is then changed in the settings. The
role `Admin`, read in the database at each request, opens the e-mail of the briefing, adding a news by its
link and several profiles.

## Overview diagrams

- [01-accounts](01-accounts.png) ([source](01-accounts.puml)): every module of the feature, its routes and utils.
- [20-signup-sequence](20-signup-sequence.png) ([source](20-signup-sequence.puml)): the signup with the questions of the AI.
- [login-sequence-diagram](login-sequence-diagram.png)
  ([source](login-sequence-diagram.puml)): the login of sprint 1, in French (its 404 for an unknown
  username is no longer what the code answers: see Login and session).

## Sub-features

- [Signup](signup/README.md): the account and its first profile in one step, closed unless `SIGNUP_OPEN=1`.
- [Login and session](login-and-session/README.md): the login, the cookie `session`, `GET /session`
  (who, and whether an administrator), the checks of every route, signing out.
- [Settings](settings/README.md): a new username, email or password, each with the current password; a
  new password ends the sessions of the other devices.
