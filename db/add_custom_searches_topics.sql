--
--  Author: Fabian Rostello
--  Date: 22.09.2026
--  File: add_custom_searches_topics.sql
--  Description: Desired and undesired topics saved with the custom searches
--

-- topics come from services/utils/topics.js (politics, economy...), empty array = no filter
ALTER TABLE public.custom_searches ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.custom_searches ADD COLUMN IF NOT EXISTS undesired_topics text[] NOT NULL DEFAULT '{}';
