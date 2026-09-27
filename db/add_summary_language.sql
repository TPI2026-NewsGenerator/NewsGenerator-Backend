--
--  Author: Fabian Rostello
--  Date: 28.09.2026
--  File: add_summary_language.sql
--  Description: the language the AI resume of an article was written in: the search writes it in
--               the language searched, so a resume in another one is written again. The resumes
--               written before are all English (NULL is read as English)
--

ALTER TABLE articles ADD COLUMN IF NOT EXISTS summary_language TEXT;
