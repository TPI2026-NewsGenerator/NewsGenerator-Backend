--
--  Author: Fabian Rostello
--  Date: 24.09.2026
--  File: add_briefing.sql
--  Description: The daily briefing: stories grouped in background, vectors of the news, the profile
--               of each user with its interests, and the briefings written for them
--
--  Can be run again: every statement checks what already exists.
--  Needs pgvector (https://github.com/pgvector/pgvector) installed on the server, and a superuser
--  to create the extension the first time.
--

CREATE EXTENSION IF NOT EXISTS vector;

-- a story: the articles of several media telling the same news, grouped by the worker as they come
CREATE TABLE IF NOT EXISTS public.stories (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lang text NOT NULL,                     -- stories are grouped per language
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS i_stories_updated_at ON public.stories (updated_at);
-- when a news last joined it: the threads (db/add_threads.sql) judge again the stories grouped since
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS grouped_at timestamp with time zone;

-- The bge-m3 vectors of a news (see services/utils/embedder.js), computed once by the worker: the
-- title for the grouping, the title and the start of the description for the profiles.
--  dense: its meaning, normalized, so the inner product of two of them is their cosine
--  sparse: the weight of each word, over the 250002 tokens of the vocabulary of bge-m3
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS lang text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS title_dense halfvec(1024);
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS title_sparse sparsevec(250002);
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS text_dense halfvec(1024);
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS text_sparse sparsevec(250002);
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS embedded_at timestamp with time zone;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS id_story integer;

-- The dense vectors in half precision (2 KB) kept in the row, as the centroids of the stories (see
-- db/add_threads.sql). As vector(1024), 4 KB each, Postgres stored them apart (TOAST: 1.15 GB of the
-- 1.48 GB of the table) and read them back through an index each time a query used them: the grouping
-- of 300 news took 9 minutes, less than the news coming in. Measured on the copies of 47 000 news of three
-- days (bench/halfvec-speed2.mjs): the scores of a news against the stories of its window 1.9 s,
-- 0.23 s in half precision kept in the row and computed once each (see assign_stories), with the same
-- stories. Half precision moves a cosine by at most 0.0001 (bench/halfvec-precision.mjs): the same story
-- for 120 news of 120 and no threshold crossed over 740 000 stories compared, the same 80 news for a
-- search by sentence (15 sentences of 17, the 80th swapped for the 2 others), the same 50 for each of
-- the 15 interests of the profiles. toast_tuple_target: a row is not shortened before 8 KB, so its
-- title, link and description stay in it too (Postgres would put them apart from 2 KB on)
ALTER TABLE public.articles SET (toast_tuple_target = 8160);
DO $$
BEGIN
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
        WHERE attrelid = 'public.articles'::regclass AND attname = 'title_dense') <> 'halfvec(1024)' THEN
        ALTER TABLE public.articles
            ALTER COLUMN title_dense TYPE halfvec(1024) USING title_dense::halfvec(1024),
            ALTER COLUMN text_dense TYPE halfvec(1024) USING text_dense::halfvec(1024);
    END IF;
END $$;
ALTER TABLE public.articles ALTER COLUMN title_dense SET STORAGE PLAIN, ALTER COLUMN text_dense SET STORAGE PLAIN;

-- The medium of a news, as mediumOf (services/utils/public-url.js) names it from its link:
-- "https://edition.cnn.com/x" -> "cnn.com", "https://www.bbc.co.uk/x" -> "bbc.co.uk"
CREATE OR REPLACE FUNCTION public.medium_of(link text)
    RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT substring(lower(substring(link from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'))
                     from '([^.]+[.](?:(?:co|com|org|net|ac|gov|edu)[.][a-z]{2}|[^.]+))$')
$$;

-- The figures written in a title, once each and sorted: "Is it 5-3 on Sept. 23?" -> {23,3,5}
CREATE OR REPLACE FUNCTION public.figures_of(title text)
    RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT COALESCE(array_agg(DISTINCT figure[1] ORDER BY figure[1]), '{}')
    FROM regexp_matches(title, '([0-9]+)', 'g') AS figure
$$;

-- filled by Postgres on each insert or update, read by assign_stories
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS medium text
    GENERATED ALWAYS AS (public.medium_of(link)) STORED;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS title_figures text[]
    GENERATED ALWAYS AS (public.figures_of(title)) STORED;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_articles_story') THEN
        ALTER TABLE public.articles ADD CONSTRAINT fk_articles_story
            FOREIGN KEY (id_story) REFERENCES public.stories(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS i_articles_story ON public.articles (id_story);
-- the worker looks for the news still without vectors, few among many
CREATE INDEX IF NOT EXISTS i_articles_not_embedded ON public.articles (created_at) WHERE embedded_at IS NULL;
CREATE INDEX IF NOT EXISTS i_articles_published ON public.articles ((COALESCE(published_at, created_at)));
-- the stories of the last hours in one language, what a new news is compared with
CREATE INDEX IF NOT EXISTS i_articles_grouped ON public.articles (lang, (COALESCE(published_at, created_at))) WHERE id_story IS NOT NULL;
-- the same news met again (same link or same title, see assign_stories): without them each news read
-- every news of its window, a page each since their vectors are in the row (145 ms). Hash: a title or
-- a link may be longer than what a btree takes
CREATE INDEX IF NOT EXISTS i_articles_link ON public.articles USING hash (link) WHERE id_story IS NOT NULL;
CREATE INDEX IF NOT EXISTS i_articles_title ON public.articles USING hash (title) WHERE id_story IS NOT NULL;

-- No HNSW index on the vectors, on purpose. The comparisons are always made on the news of the last
-- 48 hours (a few thousand rows, already narrowed by the indexes above), and exactly: a news joins a
-- story on the AVERAGE of its similarity to every member, and a briefing scores only the news of the
-- feeds of its user. An approximate "nearest k" answers neither question, and an exact scan of a few
-- thousand vectors takes milliseconds.

-- The news embedded and still in no story join the story of the window they resemble on average,
-- or start a new one. The newest first, one at a time, so a news can join a story started by
-- another of the same run. Similarity: dense + sparse_weight * sparse of the titles.
-- Measured on the stories judged by hand at 0.70, same language only: 96% of the cards gave the right
-- count of media (82% for the trigrams of the titles), and it barely depends on the order.
--
-- A medium repeats its own templates ("Is Portugal v Wales on TV?", "Is Netherlands v Germany on
-- TV?", "Goldman Sachs ... ETF declares $0.2538 dividend"): two of its titles look alike without
-- telling the same fact. So a story is judged on what the OTHER media wrote: a news is compared with
-- the members of other media only. A story of its own medium alone takes it only when the titles
-- are almost the same (threshold + same_medium_margin) and give the same figures ("Sept. 23" and
-- "Sept. 22" are two broadcasts). The same news met again (same link or same title in its medium)
-- joins its story whatever it scores.
-- Measured on 5300 news of two days: the stories of one medium went from 284 to 15, all of them
-- the same fact, and 54 news left a story told by several media, most of them another fact wrongly
-- joined (Wordle and Connections, podcast and cartoon of one meeting), about ten a second card.
--
-- Two media may also write on one subject without telling the same fact ("the balance of power" in
-- judo and in AI models, fuel prices in Europe and in Japan, a product launch and a bug found in it):
-- their titles meet, the start of their texts much less. So a news joins a story of other media only
-- when its text (title and start of the description, text_dense) is also close to theirs on average
-- (text_threshold). Measured on the 640 stories of several media of the same 5300 news, split news by
-- news by the AI and read by hand: at 0.6, 55% of the pairs of two different facts are cut and 88% of
-- the pairs of one fact kept (the text tells them apart better than the title: AUC 0.84 against 0.70,
-- the time between the two 0.68), and the big stories stay whole (the accusations against Thelyson
-- Orelien, Fury v Joshua: 14 news of 14).
--
-- Over days a story drifts: the preview of a match takes its result, the first day of a tournament
-- the next ones, since they share every name and the new news is compared with the members still in
-- the window. So a story asks more of a news the longer it has been quiet: its score loses idle_decay
-- per hour between the news and the newest member, after idle_grace hours. A news close to its story
-- still joins it days later (the same verdict reported again), a preview and its result no more.
-- Measured on a replay of this function over the news of 24-28.09 (bench/story-drift.py), 40 stories
-- over a day long read by hand: at 0.003 per hour after 6 hours, 14 of 23 drifted stories cut (4
-- before) and 2 of 12 stories of one fact (1 before), and the search cards judged by hand 80 right of
-- 128 (75 before). Hard limits (a story at most 24 hours old, idle at most 12 hours) cut the drifted
-- stories as well as the stories of one fact.
DROP FUNCTION IF EXISTS public.assign_stories(timestamptz, real, real);
DROP FUNCTION IF EXISTS public.assign_stories(timestamptz, real, real, real);
DROP FUNCTION IF EXISTS public.assign_stories(timestamptz, real, real, real, real);
-- max_news: the newest news grouped by this call, the others left to the next (all when null). One
-- call is one transaction: the 12 000 news of a first read of the directory held it 2 h 10, nothing
-- saved before the end and the ingestion waiting on it
DROP FUNCTION IF EXISTS public.assign_stories(timestamptz, real, real, real, real, real, real);
CREATE OR REPLACE FUNCTION public.assign_stories(since timestamptz, threshold real, sparse_weight real,
                                                 same_medium_margin real, text_threshold real,
                                                 idle_decay real, idle_grace real, max_news integer DEFAULT NULL)
    RETURNS TABLE (grouped integer, created integer)
    LANGUAGE plpgsql
AS $$
DECLARE
    news record;
    -- typed copies of the news judged: read through the record, Postgres plans the scores again for
    -- each news (see assign_threads)
    title_vector halfvec(1024);
    title_words sparsevec(250002);
    text_vector halfvec(1024);
    news_lang text;
    news_medium text;
    news_figures text[];
    news_at timestamptz;
    story integer;
    n_grouped integer := 0;
    n_created integer := 0;
BEGIN
    FOR news IN
        SELECT a.id, a.lang, a.link, a.title, a.medium, a.title_figures, a.title_dense, a.title_sparse, a.text_dense,
               COALESCE(a.published_at, a.created_at) AS at
        FROM articles a
        WHERE a.embedded_at IS NOT NULL
          AND a.id_story IS NULL
          AND COALESCE(a.published_at, a.created_at) >= since
        ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id
        LIMIT max_news
    LOOP
        title_vector := news.title_dense; title_words := news.title_sparse; text_vector := news.text_dense;
        news_lang := news.lang; news_medium := news.medium; news_figures := news.title_figures; news_at := news.at;

        SELECT m.id_story INTO story
        FROM articles m
        WHERE m.id_story IS NOT NULL
          AND m.lang = news_lang
          AND COALESCE(m.published_at, m.created_at) >= since
          AND m.medium IS NOT DISTINCT FROM news_medium
          AND (m.link = news.link OR m.title = news.title)
        LIMIT 1;

        IF story IS NULL THEN
            SELECT scored.id_story INTO story
            FROM (
                SELECT pairs.id_story,
                       CASE
                           -- told by other media: judged on them, on the titles and the texts
                           WHEN bool_or(NOT pairs.same_medium) THEN
                               CASE WHEN AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) >= text_threshold
                                    THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.same_medium) END
                           -- by this medium alone: almost the same title, the same figures
                           WHEN NOT bool_or(pairs.other_figures) THEN AVG(pairs.similarity) - same_medium_margin
                       END
                       -- a story quiet for a while asks more
                       - idle_decay * GREATEST(0, EXTRACT(EPOCH FROM news_at - MAX(pairs.at)) / 3600 - idle_grace) AS score
                FROM (
                    -- <#> is the negative inner product
                    SELECT m.id_story,
                           -(m.title_dense <#> title_vector) - sparse_weight * (m.title_sparse <#> title_words) AS similarity,
                           -(m.text_dense <#> text_vector) AS text_similarity,
                           m.medium IS NOT DISTINCT FROM news_medium AS same_medium,
                           COALESCE(m.published_at, m.created_at) AS at,
                           cardinality(m.title_figures) > 0 AND cardinality(news_figures) > 0
                               AND m.title_figures <> news_figures AS other_figures
                    FROM articles m
                    WHERE m.id_story IS NOT NULL
                      AND m.lang = news_lang
                      AND COALESCE(m.published_at, m.created_at) >= since
                    OFFSET 0    -- each likeness computed once, not once per aggregate that reads it
                ) pairs
                GROUP BY pairs.id_story
            ) scored
            WHERE scored.score >= threshold
            ORDER BY scored.score DESC
            LIMIT 1;
        END IF;

        IF story IS NULL THEN
            INSERT INTO stories (lang, updated_at, grouped_at) VALUES (news.lang, news.at, now()) RETURNING id INTO story;
            n_created := n_created + 1;
        ELSE
            UPDATE stories SET updated_at = GREATEST(updated_at, news.at), grouped_at = now() WHERE id = story;
        END IF;

        UPDATE articles SET id_story = story WHERE id = news.id;
        n_grouped := n_grouped + 1;
    END LOOP;

    RETURN QUERY SELECT n_grouped, n_created;
END $$;

-- what a user wants to read, in their own words
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id_user integer PRIMARY KEY,
    text text NOT NULL,                     -- "I follow rugby and fashion, no football"
    topics text[] NOT NULL DEFAULT '{}',    -- the themes ticked at the start
    languages text[] NOT NULL DEFAULT '{}', -- the languages they read
    -- the sources found for the profile: idle, running, done, failed
    discovery_status text NOT NULL DEFAULT 'idle',
    discovery_error text,
    discovered_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (id_user) REFERENCES public.users(id) ON DELETE CASCADE
);

-- the interests of a profile, one vector each: one vector for the whole profile was measured as the
-- worst method (the average of rugby and fashion is football, and the words a user refuses pull it)
CREATE TABLE IF NOT EXISTS public.profile_interests (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_user integer NOT NULL,
    position integer NOT NULL,
    text text NOT NULL,                     -- "Rugby: Top 14, Six Nations, transfers"
    weight real NOT NULL DEFAULT 1,
    keywords text NOT NULL DEFAULT '',      -- to find media and their section: "rugby, Top 14, XV de France"
    searches text[] NOT NULL DEFAULT '{}',  -- short searches for Google News
    sections text[] NOT NULL DEFAULT '{}',  -- names of the section of a newspaper: "rugby", "gastronomie"
    category text,                          -- one of db/rss-links.js, given to the feeds found for it
    dense vector(1024),
    sparse sparsevec(250002),
    CONSTRAINT fk_profile_interests_user FOREIGN KEY (id_user) REFERENCES public.users(id) ON DELETE CASCADE
);
-- for a table made by an earlier version of this file
ALTER TABLE public.profile_interests ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.profile_interests ADD COLUMN IF NOT EXISTS dense vector(1024);
ALTER TABLE public.profile_interests ADD COLUMN IF NOT EXISTS sparse sparsevec(250002);
CREATE INDEX IF NOT EXISTS i_profile_interests_user ON public.profile_interests (id_user);

-- The stories closest to the interests of a user, the best first. Only the news of the feeds they
-- read (feed_urls), published since 'since', in no story of 'excluded' (the ones already shown).
-- A news scores its best interest: weight * (dense + sparse_weight * sparse) of its title and the
-- start of its description; a story scores its best news, which is returned with it.
-- Measured on four profiles and 249 stories judged by hand: 88% of relevant cards, where one vector
-- for the whole profile gave 38%.
-- Only the news in the languages the user reads: a feed may publish in another one (a Spanish
-- edition among the sources added by hand gave a card in Spanish to a reader of French and English).
DROP FUNCTION IF EXISTS public.rank_stories(integer, text[], timestamptz, real, integer[], integer);
CREATE OR REPLACE FUNCTION public.rank_stories(user_id integer, feed_urls text[], languages text[], since timestamptz,
                                               sparse_weight real, excluded integer[], max_stories integer)
    RETURNS TABLE (id_story integer, id_article integer, id_interest integer, score double precision)
    LANGUAGE sql
    STABLE
AS $$
    WITH visible AS (
        -- a news in several feeds of the user is scored once
        SELECT DISTINCT ON (a.link) a.id, a.id_story, a.text_dense, a.text_sparse
        FROM articles a
        JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY(feed_urls)
          AND (languages IS NULL OR a.lang = ANY(languages))   -- NULL: every language, translated for the reader
          AND a.embedded_at IS NOT NULL
          AND a.id_story IS NOT NULL
          AND a.id_story <> ALL(COALESCE(excluded, '{}'))
          AND COALESCE(a.published_at, a.created_at) >= since
        ORDER BY a.link, COALESCE(a.published_at, a.created_at) DESC
    ), scored AS (
        SELECT v.id, v.id_story, best.id AS id_interest, best.score
        FROM visible v
        CROSS JOIN LATERAL (
            SELECT i.id, i.weight * (-(v.text_dense <#> i.dense) - sparse_weight * (v.text_sparse <#> i.sparse)) AS score
            FROM profile_interests i
            WHERE i.id_user = user_id AND i.dense IS NOT NULL
            ORDER BY 2 DESC
            LIMIT 1
        ) best
    )
    SELECT s.id_story, s.id, s.id_interest, s.score
    FROM (SELECT DISTINCT ON (id_story) id_story, id, id_interest, score FROM scored ORDER BY id_story, score DESC) s
    ORDER BY s.score DESC
    LIMIT max_stories
$$;

-- a feed found for the profile is replaced when the profile changes, one added by hand never is
ALTER TABLE public.user_feeds ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'user';
ALTER TABLE public.user_feeds ADD COLUMN IF NOT EXISTS language text;

-- a briefing: the stories chosen for a user at one moment, as shown to them
CREATE TABLE IF NOT EXISTS public.briefings (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_user integer NOT NULL,
    status text NOT NULL DEFAULT 'running', -- running, ready, failed
    step text,                              -- what it is doing, shown while it runs
    error text,
    items jsonb NOT NULL DEFAULT '[]',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    finished_at timestamp with time zone,
    CONSTRAINT fk_briefings_user FOREIGN KEY (id_user) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS i_briefings_user ON public.briefings (id_user, created_at DESC);
