--
--  Author: Fabian Rostello
--  Date: 13.10.2026
--  File: add_named_entities.sql
--  Description: The people, organisations and places each news names, found by the tagger (ner/server.py)
--               as the news are read, and the item of Wikidata each name is, when only one is called
--               so (see tagging-service.js). Run db/add_untagged_index.sql after it
--

-- when the tagger read the news, null before: the ones without it wait, the newest first
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS entities_at timestamptz;

-- A name as the news write it, once per kind: "Gianni Infantino" person, "LFF" organization. key: the
-- name as it is compared, in small letters, without accents nor a leading article ("la fédération
-- lettone de football" -> "federation lettone de football", see mentions.js). lang: of the first news
-- naming it, the language Wikidata is searched in. qid: the item of Wikidata it is, null when none or
-- several are called so ("Paris", "LFF" of Latvia and of Lithuania), linked_at when it was looked for.
-- seen: the news naming it since it was first met, the most named are looked for first
CREATE TABLE IF NOT EXISTS public.mentions (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key text NOT NULL,
    kind text NOT NULL,                     -- person, organization, location
    name text NOT NULL,
    lang text,
    qid text,
    linked_at timestamptz,
    seen integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (key, kind)
);
CREATE INDEX IF NOT EXISTS i_mentions_qid ON public.mentions (qid) WHERE qid IS NOT NULL;
CREATE INDEX IF NOT EXISTS i_mentions_to_link ON public.mentions (seen DESC) WHERE linked_at IS NULL;

-- the names of each news; gone with the news (see FeedService, the retention)
CREATE TABLE IF NOT EXISTS public.article_mentions (
    id_mention integer NOT NULL REFERENCES public.mentions(id) ON DELETE CASCADE,
    id_article integer NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    PRIMARY KEY (id_mention, id_article)
);
CREATE INDEX IF NOT EXISTS i_article_mentions_article ON public.article_mentions (id_article);
