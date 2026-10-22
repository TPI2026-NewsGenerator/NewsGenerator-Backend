--
--  Author: Fabian Rostello
--  Date: 22.10.2026
--  File: add_mention_candidates.sql
--  Description: The items of Wikidata a name may be (the qids the link loop found when it left the name with
--               none), kept so that a card chooses among them with what it says (see name-check.js): null
--               while the name was not looked for since, [] when nothing was found
--

ALTER TABLE public.mentions ADD COLUMN IF NOT EXISTS candidates jsonb;
