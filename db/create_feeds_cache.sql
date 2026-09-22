--
--  Author: Fabian Rostello
--  Date: 22.09.2026
--  File: create_feeds_cache.sql
--  Description: Cache tables for RSS feeds and their articles (refreshed in background)
--

-- one row per RSS feed url, stores HTTP cache headers to use conditional requests (304 Not Modified)
CREATE TABLE IF NOT EXISTS public.feeds (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    url text NOT NULL,
    etag text,
    last_modified text,
    last_fetched_at timestamp with time zone,
    last_error text,
    CONSTRAINT u_feeds UNIQUE (url)
);

-- news items read from the feeds
CREATE TABLE IF NOT EXISTS public.articles (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_feed integer NOT NULL,
    link text NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    thumbnail text,
    category text[] NOT NULL DEFAULT '{}',
    published_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT u_articles UNIQUE (id_feed, link),
    CONSTRAINT fk_id_feed FOREIGN KEY (id_feed) REFERENCES public.feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS i_articles_created_at ON public.articles (created_at);

-- AI resume and topic (politics, economy...) of the news, given only when the user asks for the resume,
-- null until then, kept to answer the next requests without calling the AI again
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS topic text;
