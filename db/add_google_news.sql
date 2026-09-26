--
--  Author: Fabian Rostello
--  Date: 26.09.2026
--  File: add_google_news.sql
--  Description: The news read through Google News (see services/utils/google-news.js): their real
--               publisher, and their real address once a briefing needed it
--
--  Needs PostgreSQL 17 or later (ALTER COLUMN ... SET EXPRESSION).
--

-- the publisher Google News names for a news (<source url="https://www.lequipe.fr">): its link is a
-- redirect of Google, the publisher is the only way to know its medium. Null for the other feeds
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS source_url text;

-- the real address of a news of Google News, found when a briefing reads it (never twice)
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS resolved_link text;

-- the medium of a news of Google News is its publisher, not google.com: two media telling a story
-- through Google are two voices, and one of them met again through its own feed is the same one
ALTER TABLE public.articles ALTER COLUMN medium SET EXPRESSION AS (public.medium_of(COALESCE(source_url, link)));
