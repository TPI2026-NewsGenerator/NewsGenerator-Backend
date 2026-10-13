--
--  Author: Fabian Rostello
--  Date: 13.10.2026
--  File: add_follow_in_briefing.sql
--  Description: One list of what a profile follows (the user, 13.10.2026): the items of Wikidata
--               (profile_entities) and the names or words as written (user_profiles.watch_terms). An
--               item's news are in the briefing beside the ones of the words unless its reader unticks
--               it: the UEFA alone names a hundred news a day
--

ALTER TABLE public.profile_entities ADD COLUMN IF NOT EXISTS in_briefing boolean NOT NULL DEFAULT true;

-- the words that are a name of an item the profile follows were copied there to bring its news into the
-- briefing ("Roberto Rosetti"): the item does it now, the word goes
UPDATE public.user_profiles p
SET watch_terms = ARRAY(
    SELECT t.term FROM unnest(p.watch_terms) WITH ORDINALITY AS t(term, place)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.profile_entities pe JOIN public.entities e ON e.id = pe.id_entity
        WHERE pe.id_profile = p.id
          AND lower(t.term) = ANY (SELECT lower(n) FROM unnest(e.names || e.label || pe.added_names) AS n)
          AND NOT lower(t.term) = ANY (SELECT lower(n) FROM unnest(pe.removed_names) AS n))
    ORDER BY t.place)
WHERE cardinality(p.watch_terms) > 0;
