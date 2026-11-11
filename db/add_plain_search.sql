--
--  Author: Fabian Rostello
--  Date: 11.11.2026
--  File: add_plain_search.sql
--  Description: The text searched by the keywords filter, without its accents, with its own index of trigrams (see FeedModel.searchArticles)
--

-- The keywords of a search are read with and without their accents ("zurich" finds "Zürich"). They were written as classes of letters
-- ("[iìíîï][nñ]f[aàáâãäå][nñ]t..."), and the index of trigrams reads a class of more than 4 letters as any letter: "infantino" had almost no
-- trigram left to ask for, Postgres read the whole window and a week of every feed took 30 to 60 s (4.2 million news, 11.11.2026). Folded by
-- Postgres on both sides, with the letters as they are, the same search takes 0.6 s, and finds the letters the classes of Latin-1 did not know
-- (Łódź, Ødegaard, Straße, Plzeň). The server uses it as soon as the index is built and valid, and works as before until then: this file can be run
-- before or after the server is deployed.

-- already installed (db/add_unaccent.sql)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE, because its dictionary can change; an index needs an IMMUTABLE function: the dictionary is named, so this one is
-- too (the same wrapper everyone writes). The server writes public.plain_text(search_text): the same text as this index
CREATE OR REPLACE FUNCTION public.plain_text(text)
    RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- The index of the folded text, one more of the size of i_articles_search_text (5.7 GB on 4.6 million news). CONCURRENTLY: the ingestion and the
-- readers go on while it is built, so it cannot run in a transaction (psql -f runs a file statement by statement, which is fine). It takes tens of
-- minutes. One that fails leaves an index that is NOT VALID, which the server does not use and which IF NOT EXISTS would then skip: drop it first
--   DROP INDEX CONCURRENTLY IF EXISTS public.i_articles_search_plain;
SET maintenance_work_mem = '2GB';
CREATE INDEX CONCURRENTLY IF NOT EXISTS i_articles_search_plain ON public.articles USING gin (public.plain_text(search_text) gin_trgm_ops);

-- built and valid? (indisvalid = t)
--   SELECT indisvalid, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_index WHERE indexrelid = 'public.i_articles_search_plain'::regclass;
