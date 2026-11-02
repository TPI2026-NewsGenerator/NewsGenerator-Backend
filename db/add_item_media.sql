--
--  Author: Fabian Rostello
--  Date: 03.11.2026
--  File: add_item_media.sql
--  Description: Whether an item a card names is a news medium (a newspaper, an agency, a channel), beside its
--               country (see countries.js): "L'Équipe: Burleanu could be UEFA's candidate" is a card of
--               Romania, the French newspaper only says it (the user, 03.11.2026: a card showed France)
--

-- media: true for a news medium (wikidata.js MEDIA_KINDS), false for anything else; null for a row read
-- before 03.11.2026, read again when a card names it
ALTER TABLE public.item_countries ADD COLUMN IF NOT EXISTS media boolean;
