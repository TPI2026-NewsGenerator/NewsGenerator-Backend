-- A session is a token valid 7 days (services/utils/jwt.js): the second of the last change of password
-- of an account ends the sessions opened before, on its other devices. NULL: never changed
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
