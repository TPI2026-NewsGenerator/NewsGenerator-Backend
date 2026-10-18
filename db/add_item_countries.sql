--
--  Author: Fabian Rostello
--  Date: 18.10.2026
--  File: add_item_countries.sql
--  Description: The country of each item of Wikidata a card names, read once (see countries.js): a card
--               shows the countries of who it is about, for a reader who does not know them
--

-- qid: the item (a person, an organisation, a place); country: its code ISO 3166-1 alpha-2 ("ZM"), null
-- when it has none (an international body, a continent, a person without citizenship in Wikidata);
-- international: a body of several countries or of the world (FIFA, the UN, Google): the people of a
-- card naming one are not of its country (Infantino of FIFA is no Swiss news)
CREATE TABLE IF NOT EXISTS public.item_countries (
    qid text PRIMARY KEY,
    country text,
    international boolean NOT NULL DEFAULT false,
    looked_at timestamptz NOT NULL DEFAULT now()
);
