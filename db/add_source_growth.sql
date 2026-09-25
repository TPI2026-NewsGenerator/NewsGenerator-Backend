--
--  Author: Fabian Rostello
--  Date: 25.09.2026
--  File: add_source_growth.sql
--  Description: The sources of a reader grow: the ones a reader shares, and the index the suggestions
--               of sources read the feeds of every reader with
--

-- a source added by hand the reader chose to share: it can be suggested to the other readers whose
-- interests it publishes on (see services/recommendation-service.js). Never shared without it: a
-- source added by hand says what its reader follows, and its address can hold a private key
ALTER TABLE public.user_feeds ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;

-- the suggestions look a feed up by its address among the rows of every reader
CREATE INDEX IF NOT EXISTS i_user_feeds_url ON public.user_feeds (url);
