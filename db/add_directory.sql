--
--  Author: Fabian Rostello
--  Date: 30.09.2026
--  File: add_directory.sql
--  Description: The directory of the project: feeds found by the server itself, read by every search
--               of their language (see services/directory-service.js)
--

-- A feed of the directory. 'named': the main feed of a medium Google News names in the searches of the
-- profiles and no feed of ours reads. 'section': a feed of a medium already read that brings the news
-- its feeds read miss. category null: a medium on everything, read whatever the categories searched
CREATE TABLE IF NOT EXISTS public.directory_feeds (
    url        text PRIMARY KEY,
    medium     text NOT NULL,
    origin     text NOT NULL CHECK (origin IN ('named', 'section')),
    language   text,
    category   text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS i_directory_feeds_language ON public.directory_feeds (language);

-- A medium looked at, found or not: looked at again only after some days, a site without a feed
-- stays without one for a while
CREATE TABLE IF NOT EXISTS public.directory_tries (
    medium   text NOT NULL,
    origin   text NOT NULL CHECK (origin IN ('named', 'section')),
    tried_at timestamptz NOT NULL DEFAULT now(),
    kept     integer NOT NULL DEFAULT 0,
    reason   text,
    PRIMARY KEY (medium, origin)
);
