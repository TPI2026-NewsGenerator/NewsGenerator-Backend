--
--  Author: Fabian Rostello
--  Date: 12.10.2026
--  File: add_articles_medium_index.sql
--  Description: The news of one medium of the last days, read for the official source of a card (the
--               posts of uefa.com our feeds already read): 8.7 s over the 1 000 000 news of 8 days
--               without it. Built without locking the ingestion, so alone in its file (CONCURRENTLY
--               runs outside a transaction)
--

CREATE INDEX CONCURRENTLY IF NOT EXISTS i_articles_medium ON public.articles (medium, created_at);
