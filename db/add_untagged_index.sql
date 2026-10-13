--
--  Author: Fabian Rostello
--  Date: 13.10.2026
--  File: add_untagged_index.sql
--  Description: The news the tagger has not read yet, the newest first (see add_named_entities.sql): a
--               news leaves it once tagged. Built without locking the ingestion, so alone in its file
--               (CONCURRENTLY runs outside a transaction)
--

CREATE INDEX CONCURRENTLY IF NOT EXISTS i_articles_untagged ON public.articles (created_at DESC) WHERE entities_at IS NULL;
