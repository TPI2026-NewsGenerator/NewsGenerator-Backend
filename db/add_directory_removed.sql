--
--  Author: Fabian Rostello
--  Date: 09.10.2026
--  File: add_directory_removed.sql
--  Description: The feeds the directory took out because they serve no reader, kept to say why and so
--               that the directory does not add them again at once (see services/directory-service.js)
--

CREATE TABLE IF NOT EXISTS public.directory_removed (
    url        text PRIMARY KEY,
    medium     text NOT NULL,
    origin     text NOT NULL CHECK (origin IN ('named', 'section')),
    language   text,
    category   text,
    -- what it gave at the time: its news of the last days, and how many of them were on an interest
    news       integer NOT NULL DEFAULT 0,
    relevant   integer NOT NULL DEFAULT 0,
    reason     text NOT NULL,
    removed_at timestamptz NOT NULL DEFAULT now()
);
