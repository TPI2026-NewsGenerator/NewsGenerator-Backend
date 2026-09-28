--
--  Author: Fabian Rostello
--  Date: 28.09.2026
--  File: add_extracts.sql
--  Description: the key passages of an article, in its own words, and their translation: the AI only
--               picks sentences (services/utils/extract.js), so the passages hold for any reader and
--               only the translation depends on the language. Replaces add_summary_language.sql, a
--               column of the summaries written by the AI, which are no longer shown
--

ALTER TABLE articles ADD COLUMN IF NOT EXISTS extract JSONB;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS translation JSONB;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS translation_language TEXT;
ALTER TABLE articles DROP COLUMN IF EXISTS summary_language;
