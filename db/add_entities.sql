--
--  Author: Fabian Rostello
--  Date: 08.10.2026
--  File: add_entities.sql
--  Description: The clubs, people and organisations a reader follows, as Wikidata knows them: their
--               names, to find the news naming them, and their links (the players of a club, its
--               coach, its league), to gather the news of all of them
--

-- an item of Wikidata: one row per item, shared by every reader. names: the ones its news are found
-- by (its label in the languages read, its aliases kept, see wikidata.js). A linked item only met as a
-- link has its label alone until a reader follows it, then it is read in full (fetched_at)
CREATE TABLE IF NOT EXISTS public.entities (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    qid text NOT NULL UNIQUE,
    label text NOT NULL,
    description text,
    kind text NOT NULL DEFAULT 'other',         -- person, club, team, competition, organisation, other
    names text[] NOT NULL DEFAULT '{}',
    fetched_at timestamptz                       -- read in full from Wikidata, null for a link only
);

-- what an item says of another: 'player' (of a club), 'coach', 'league', 'team' (of a person)...
CREATE TABLE IF NOT EXISTS public.entity_links (
    id_from integer NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    id_to integer NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    relation text NOT NULL,
    PRIMARY KEY (id_from, id_to, relation)
);
CREATE INDEX IF NOT EXISTS i_entity_links_to ON public.entity_links (id_to);

-- the items a profile follows, with the names its reader added ("PSG") or took out ("Paris")
CREATE TABLE IF NOT EXISTS public.profile_entities (
    id_profile integer NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    id_entity integer NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    added_names text[] NOT NULL DEFAULT '{}',
    removed_names text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_profile, id_entity)
);
