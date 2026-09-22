--
--  Author: Fabian Rostello
--  Date: 22.09.2026
--  File: add_articles_search.sql
--  Description: Text searched by the keywords filter, prepared once per article and indexed
--

-- trigram index: lets Postgres use an index for the regex (~*) of the keywords filter
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- text searched in a news: title, description without HTML and RSS categories
-- " | " between the fields so a phrase can't start in one field and end in another
-- IMMUTABLE so it can be used in a generated column (array_to_string is always the same for text[])
CREATE OR REPLACE FUNCTION public.article_search_text(title text, description text, category text[])
    RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT title || ' | ' || regexp_replace(description, '<[^>]*>', ' ', 'g') || ' | ' || array_to_string(category, ' | ')
$$;

-- filled by Postgres on each insert or update
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (public.article_search_text(title, description, category)) STORED;

CREATE INDEX IF NOT EXISTS i_articles_search_text ON public.articles USING gin (search_text gin_trgm_ops);
