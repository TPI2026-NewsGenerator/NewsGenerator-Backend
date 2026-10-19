--
--  Author: Fabian Rostello
--  Date: 19.10.2026
--  File: add_item_bodies.sql
--  Description: The bodies a person is of, beside their country (see countries.js): only the people of
--               an international body a card names lose their country, not every person of that card
--               (a Romanian referee on a card naming UEFA showed Italy only, from Milan)
--

-- bodies: the qids of the bodies a person works for, is a member of or holds a position of, still
-- (wikidata.js bodiesOfClaims), empty for anything else; null for a row read before 19.10.2026, read
-- again (with the federations no longer international: their parent organisation is UEFA, they are not
-- part of it)
ALTER TABLE public.item_countries ADD COLUMN IF NOT EXISTS bodies text[];
