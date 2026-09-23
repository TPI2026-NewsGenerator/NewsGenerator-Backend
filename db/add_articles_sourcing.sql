--
--  Author: Fabian Rostello
--  Date: 23.09.2026
--  File: add_articles_sourcing.sql
--  Description: who an article credits for what it reports, answered by the AI with the summary
--

ALTER TABLE articles ADD COLUMN IF NOT EXISTS sourcing TEXT;
