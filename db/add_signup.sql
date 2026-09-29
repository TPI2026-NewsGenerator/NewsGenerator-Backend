--
--  Author: Fabian Rostello
--  Date: 29.09.2026
--  File: add_signup.sql
--  Description: Accounts created by the readers themselves (POST /signup): one account per name and
--               per email, whatever their case
--

-- u_users already refuses the same name twice, but "Fab" and "fab" would be two accounts, and the
-- login finds a reader by their name
CREATE UNIQUE INDEX IF NOT EXISTS u_users_username_ci ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS u_users_email_ci ON users (lower(email));
