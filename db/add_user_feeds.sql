--
--  Author: Fabian Rostello
--  Date: 22.09.2026
--  File: add_user_feeds.sql
--  Description: Feeds added by a user, private: they are only used in the searches of this user
--

CREATE TABLE IF NOT EXISTS public.user_feeds (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_user integer NOT NULL,
    url text NOT NULL,              -- the feed itself, found from the site given by the user
    site text NOT NULL,             -- what the user typed, shown back to them
    category text NOT NULL,         -- one of the categories of db/rss-links.js
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT u_user_feeds UNIQUE (id_user, url),
    CONSTRAINT fk_user_feeds_user FOREIGN KEY (id_user) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS i_user_feeds_user ON public.user_feeds (id_user);
