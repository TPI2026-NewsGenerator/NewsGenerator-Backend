--
--  Author: Fabian Rostello
--  Date: 02.11.2026
--  File: add_mail_labels.sql
--  Description: The words of the e-mail of a briefing ("Key points", "Contested", "{by} denies:"...) as the AI
--               translated them for a reader of another language, kept so that the e-mail says the same words
--               from one session of the server to the next (see services/utils/mail-labels.js)
--

-- One row per word of the e-mail (its English text) and language. The English text is the key: a word the code
-- changes is another row, translated again; a row is never replaced, so a translation corrected by hand stays.
CREATE TABLE IF NOT EXISTS public.mail_labels (
    language text NOT NULL,
    source text NOT NULL,
    translation text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (language, source)
);
