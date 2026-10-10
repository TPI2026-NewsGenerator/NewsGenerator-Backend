--
--  Author: Fabian Rostello
--  Date: 10.10.2026
--  File: add_sent_mails.sql
--  Description: The e-mails of a briefing as they were sent: a mail forwarded can be changed by whoever
--               forwards it, its link leads to this copy, which nobody can change
--

-- token: the secret part of the address of the copy (/api/mails/<token>), anyone who has the e-mail
-- can read it, nobody can guess it. html: the e-mail as sent, its joined pictures written in it
CREATE TABLE IF NOT EXISTS public.sent_mails (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token text NOT NULL UNIQUE,
    id_user integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    id_briefing integer REFERENCES public.briefings(id) ON DELETE SET NULL,
    subject text NOT NULL,
    html text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
