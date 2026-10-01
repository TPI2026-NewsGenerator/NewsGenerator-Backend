--
--  Author: Fabian Rostello
--  Date: 28.09.2026
--  File: add_threads.sql
--  Description: The threads: the stories (the facts) of one affair followed over days, a preview, its
--               result and the reactions to it, linked in background after the grouping
--
--  Can be run again: every statement checks what already exists. Run after add_briefing.sql.
--

-- A story tells one fact, and asks more of a news the longer it has been quiet (assign_stories): the
-- preview of a match and its result are two stories. A reader searching "what happened" wants both,
-- in their order. So the stories of one affair are linked in a thread, the search shows a thread as
-- one card with its facts in time order, and the briefing keeps showing the facts.
CREATE TABLE IF NOT EXISTS public.threads (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lang text NOT NULL,                     -- a thread is of one language, as its stories
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),    -- its newest news
    centroid halfvec(1024),                 -- the mean of the centroids of its stories (not normalized)
    media text[] NOT NULL DEFAULT '{}',     -- the media of its news
    n_stories integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS i_threads_lang_updated ON public.threads (lang, updated_at);

-- what a story is judged on: the mean of the texts of its news (text_dense, title and start of the
-- description), normalized, and the media that wrote it
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS id_thread integer;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS centroid halfvec(1024);
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS media text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS threaded_at timestamp with time zone;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stories_thread') THEN
        ALTER TABLE public.stories ADD CONSTRAINT fk_stories_thread
            FOREIGN KEY (id_thread) REFERENCES public.threads(id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS i_stories_thread ON public.stories (id_thread);

-- A story is compared with every story of its language of the last days, run after run: the centroids
-- are read thousands of times. In half precision (2 KB) and kept in the row they are read three times
-- faster than a vector(1024), 4 KB stored apart by Postgres (TOAST): 16 ms against 25 to 62 ms for
-- 3500 stories. Half precision moves a cosine by a few thousandths, the thresholds are 0.70 and 0.75
DO $$
BEGIN
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
        WHERE attrelid = 'public.stories'::regclass AND attname = 'centroid') <> 'halfvec(1024)' THEN
        ALTER TABLE public.stories ALTER COLUMN centroid TYPE halfvec(1024) USING centroid::halfvec(1024);
    END IF;
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
        WHERE attrelid = 'public.threads'::regclass AND attname = 'centroid') <> 'halfvec(1024)' THEN
        ALTER TABLE public.threads ALTER COLUMN centroid TYPE halfvec(1024) USING centroid::halfvec(1024);
    END IF;
END $$;
ALTER TABLE public.stories ALTER COLUMN centroid SET STORAGE PLAIN;
ALTER TABLE public.threads ALTER COLUMN centroid SET STORAGE PLAIN;
-- the stories grouped since their thread was judged, few among many
CREATE INDEX IF NOT EXISTS i_stories_to_thread ON public.stories (grouped_at) WHERE grouped_at IS NOT NULL;
-- the stories waiting for their thread, as assign_threads asks for them: without it each call read the
-- 43 000 stories twice (0.9 s with none waiting, the tests of the threads went over their 5 s)
CREATE INDEX IF NOT EXISTS i_stories_waiting ON public.stories (updated_at, id)
    WHERE grouped_at > COALESCE(threaded_at, '-infinity'::timestamptz);
-- the stories of one language a story is compared with: a language of few stories reads only them
CREATE INDEX IF NOT EXISTS i_stories_lang ON public.stories (lang) WHERE centroid IS NOT NULL;

-- The stories that got news since their thread was judged take the centroid of their news now and
-- are judged again: each leaves its thread and joins the thread of its language, active in the last
-- active_days, whose stories it resembles on average, above threshold, or starts one. Like the
-- stories (assign_stories), a thread is judged on what the OTHER media wrote: a medium repeats its
-- own series ("Moon phase today", ETF dividends, "Match ce soir") that look alike without being an
-- affair, so a story reaching a thread only through stories sharing one of its media needs
-- same_medium_margin more.
-- Two facts of one affair born apart start two threads that nothing would join afterwards (the Man
-- City verdict and the reactions to it). So the threads touched are then joined to the thread of their
-- language they resemble most on average (the product of their mean centroids is the average likeness
-- of their stories two by two), above merge_threshold, with the same margin for shared media.
-- Measured on a replay run by run of the news of 24-28.09 (bench/story-threads-online.py), 316 news
-- of 40 long stories labelled by hand with their affair and fact: at 0.75, 0.70 to join threads and
-- 0.10 for shared media, 93% of the pairs of one fact in one thread, 80% of the pairs of one affair,
-- 55 of 74 search cards of one news in one thread (33 as stories); 23 of 30 threads read at random were
-- one affair, 3 a series of one medium, 4 too broad (qualifiers of a whole competition). Without the
-- joining 53 cards and 72% of the affairs; joining without the margin brought the series back.
-- max_stories: the stories judged by this call, the oldest first, the others left to the next (all
-- when null): one call is one transaction, see assign_stories
DROP FUNCTION IF EXISTS public.assign_threads(real, real, real, integer);
CREATE OR REPLACE FUNCTION public.assign_threads(threshold real, same_medium_margin real, merge_threshold real,
                                                 active_days integer, max_stories integer DEFAULT NULL)
    RETURNS TABLE (touched integer, created integer, merged integer)
    LANGUAGE plpgsql
AS $$
DECLARE
    active constant timestamptz := now() - make_interval(days => active_days);
    s record;
    t record;
    -- typed copies of the story or thread judged: the plans of the queries below are kept from one to
    -- the next (read through a record, the scoring took ten times longer)
    v halfvec(1024);
    m text[];
    l text;
    best integer;
    best_score real;
    changed integer[] := '{}';
    n_touched integer := 0;
    n_created integer := 0;
    n_merged integer := 0;
BEGIN
    -- each story waiting reads its own news (LATERAL): joined, Postgres read every news of a story,
    -- a page each since their vectors are in the row (1.4 s for one story waiting)
    UPDATE stories st
    SET centroid = l2_normalize(m.centroid)::halfvec(1024), media = m.media
    FROM (
        SELECT x.id AS id_story, news.centroid, news.media
        FROM stories x,
             LATERAL (SELECT avg(a.text_dense) AS centroid,
                             COALESCE(array_agg(DISTINCT a.medium) FILTER (WHERE a.medium IS NOT NULL), '{}') AS media
                      FROM articles a
                      WHERE a.id_story = x.id AND a.text_dense IS NOT NULL) news
        WHERE x.grouped_at > COALESCE(x.threaded_at, '-infinity') AND news.centroid IS NOT NULL
    ) m
    WHERE st.id = m.id_story;

    FOR s IN
        SELECT id, lang, id_thread, centroid, media, updated_at
        FROM stories
        WHERE grouped_at > COALESCE(threaded_at, '-infinity') AND centroid IS NOT NULL
        ORDER BY updated_at, id
        LIMIT max_stories
    LOOP
        UPDATE stories SET id_thread = NULL WHERE id = s.id;
        best := NULL;
        v := s.centroid; m := s.media; l := s.lang;

        SELECT scored.id_thread, scored.score INTO best, best_score
        FROM (
            SELECT pairs.id_thread,
                   CASE
                       WHEN bool_or(NOT pairs.shared) THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.shared)
                       ELSE AVG(pairs.similarity) - same_medium_margin
                   END AS score
            FROM (
                SELECT o.id_thread, -(o.centroid <#> v) AS similarity, o.media && m AS shared
                FROM stories o JOIN threads th ON th.id = o.id_thread
                WHERE o.lang = l AND th.updated_at >= active AND o.centroid IS NOT NULL
                OFFSET 0    -- each likeness computed once, not once per aggregate that reads it
            ) pairs
            GROUP BY pairs.id_thread
        ) scored
        WHERE scored.score >= threshold
        ORDER BY scored.score DESC
        LIMIT 1;

        IF best IS NULL THEN
            -- nothing close enough: back to its own thread if nobody else is in it, or a new one
            IF s.id_thread IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stories WHERE id_thread = s.id_thread) THEN
                best := s.id_thread;
            ELSE
                INSERT INTO threads (lang, updated_at) VALUES (s.lang, s.updated_at) RETURNING id INTO best;
                n_created := n_created + 1;
            END IF;
        END IF;

        UPDATE stories SET id_thread = best, threaded_at = now() WHERE id = s.id;
        UPDATE threads SET updated_at = GREATEST(updated_at, s.updated_at) WHERE id = best;
        changed := changed || best;
        IF s.id_thread IS NOT NULL AND s.id_thread <> best THEN changed := changed || s.id_thread; END IF;
        n_touched := n_touched + 1;
    END LOOP;

    -- the threads that took or lost a story: their centroid, media and size again
    UPDATE threads th
    SET centroid = m.centroid, n_stories = m.n,
        media = COALESCE((SELECT array_agg(DISTINCT x) FROM stories o, unnest(o.media) x WHERE o.id_thread = th.id), '{}')
    FROM (SELECT id_thread, avg(centroid) AS centroid, count(*) AS n FROM stories
          WHERE id_thread = ANY(changed) AND centroid IS NOT NULL GROUP BY id_thread) m
    WHERE th.id = m.id_thread;
    DELETE FROM threads th WHERE th.id = ANY(changed) AND NOT EXISTS (SELECT 1 FROM stories o WHERE o.id_thread = th.id);

    FOR t IN SELECT DISTINCT unnest(changed) AS id LOOP
        -- joined to another one meanwhile, or left without story
        v := NULL;
        SELECT centroid, media, lang INTO v, m, l FROM threads WHERE id = t.id;
        CONTINUE WHEN v IS NULL;

        SELECT u.id, -(u.centroid <#> v) - CASE WHEN u.media && m THEN same_medium_margin ELSE 0 END
        INTO best, best_score
        FROM threads u
        WHERE u.lang = l AND u.id <> t.id AND u.updated_at >= active AND u.centroid IS NOT NULL
        ORDER BY 2 DESC
        LIMIT 1;

        IF best IS NOT NULL AND best_score >= merge_threshold THEN
            UPDATE stories SET id_thread = best WHERE id_thread = t.id;
            UPDATE threads th
            SET updated_at = GREATEST(th.updated_at, (SELECT updated_at FROM threads WHERE id = t.id)),
                centroid = mean.centroid, n_stories = mean.n,
                media = COALESCE((SELECT array_agg(DISTINCT x) FROM stories o, unnest(o.media) x WHERE o.id_thread = th.id), '{}')
            FROM (SELECT avg(centroid) AS centroid, count(*) AS n FROM stories WHERE id_thread = best AND centroid IS NOT NULL) mean
            WHERE th.id = best;
            DELETE FROM threads WHERE id = t.id;
            n_merged := n_merged + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT n_touched, n_created, n_merged;
END $$;
