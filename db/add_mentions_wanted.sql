--
--  Author: Fabian Rostello
--  Date: 13.10.2026
--  File: add_mentions_wanted.sql
--  Description: The names a reader sees (on a card, the page of a name) looked for in Wikidata first:
--               the others wait their turn, the most met first, about 12 000 a day for 150 000 met
--               3 times or more (13.10.2026)
--

ALTER TABLE public.mentions ADD COLUMN IF NOT EXISTS wanted_at timestamptz;

CREATE INDEX IF NOT EXISTS i_mentions_wanted ON public.mentions (wanted_at)
    WHERE linked_at IS NULL AND wanted_at IS NOT NULL;
