--
--  Author: Fabian Rostello
--  Date: 23.09.2026
--  File: add_unaccent.sql
--  Description: Compare the titles without their accents when grouping the news telling the same
--               story (see FeedModel.similarArticlePairs)
--

-- Two papers do not spell a name the same way. The Guardian writes "Higuaín" where the Independent
-- writes "Higuain", and that single accent changes enough trigrams to move the pair from 0.325 to
-- 0.294: grouped, or not grouped. Measured on a day of articles, comparing without the accents adds
-- 0.75% of pairs, and almost all of them are French, Spanish or Italian, where accents are common.
CREATE EXTENSION IF NOT EXISTS unaccent;
