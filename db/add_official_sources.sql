--
--  Author: Fabian Rostello
--  Date: 12.10.2026
--  File: add_official_sources.sql
--  Description: "Official source" of a card: the parties a news is about (a club, a body, a company)
--               as Wikidata knows them, with their own channels, to find the post where they said
--               it themselves (see services/utils/official-sources.js)
--

-- the channels an item publishes on, as Wikidata gives them (website P856, X P2002, Instagram P2003,
-- Facebook P2013, YouTube P2397, TikTok P7085, Mastodon P4033, Bluesky P12361, Telegram P3789):
-- {"site": ["https://www.uefa.com"], "bluesky": [...], ...}, read again after 30 days. site_feed: the
-- feed of its website, found once and tried again after 7 days; '' when it has none, a built one
-- (RSS-Bridge) is never sent to a client
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS channels jsonb;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS channels_at timestamptz;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS site_feed text;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS site_feed_at timestamptz;

-- the item of Wikidata the AI's name of a party is, searched once: "CONI" -> the Italian National
-- Olympic Committee. qid null: none found, searched again after 7 days
CREATE TABLE IF NOT EXISTS public.party_names (
    name text NOT NULL,
    what text NOT NULL DEFAULT '',
    qid text,
    checked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (name, what)
);
