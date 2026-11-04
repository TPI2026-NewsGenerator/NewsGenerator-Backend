--
--  Author: Fabian Rostello
--  Date: 04.11.2026
--  File: add_affairs.sql
--  Description: The affairs a reader follows (a saga told over days, found behind a card of the briefing), the
--               events found for each since, the alerts they gave, and the devices that receive them
--
--  Can be run again: every statement checks what already exists. Run after add_threads.sql.
--

-- An affair is followed by one reader, from one card. It is no thread (db/add_threads.sql): a thread is of one
-- language, is joined to another one and goes with its news at the end of the retention (30 days), while an
-- affair followed keeps its events as long as it is followed. What the stories created since are compared with is the
-- centroid of its stories (their mean, read when needed: no column to keep in step).
CREATE TABLE IF NOT EXISTS public.affairs (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_user integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    id_profile integer,                     -- the profile it was followed from: its sources, its language
    title text NOT NULL,                    -- its name, in the language of the reader
    language text NOT NULL,                 -- the language the events are told in
    about text NOT NULL DEFAULT '',         -- what it covers and what it does not (English): the file the AI judges by
    not_about text NOT NULL DEFAULT '',
    anchor_story integer,                   -- the story of the card it was followed from
    story_ids integer[] NOT NULL DEFAULT '{}',  -- the stories of its events
    view jsonb NOT NULL,                    -- its events and its coverage, as the page shows them (see affair.js)
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    checked_at timestamp with time zone NOT NULL DEFAULT now(),     -- the stories created since are the ones to judge
    last_event_at timestamp with time zone,
    seen_at timestamp with time zone NOT NULL DEFAULT now()         -- when the reader last opened it
);
CREATE INDEX IF NOT EXISTS i_affairs_user ON public.affairs (id_user);

-- What was found since the reader last looked: each alert is a key event (see affair-events.js) that passed the
-- second opinion of the AI. The page shows them with a badge; the device is told once (pushed_at)
CREATE TABLE IF NOT EXISTS public.affair_alerts (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_affair integer NOT NULL REFERENCES public.affairs(id) ON DELETE CASCADE,
    id_user integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event jsonb NOT NULL,                   -- the event as it was when found
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    pushed_at timestamp with time zone,
    read_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS i_affair_alerts_user ON public.affair_alerts (id_user, created_at DESC);
CREATE INDEX IF NOT EXISTS i_affair_alerts_affair ON public.affair_alerts (id_affair, created_at DESC);
CREATE INDEX IF NOT EXISTS i_affair_alerts_unpushed ON public.affair_alerts (id_user) WHERE pushed_at IS NULL;

-- The devices that receive the alerts (web push): one per browser or home-screen app the reader allowed. The
-- endpoint is the address of their push service, the keys are theirs to read the message
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_user integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    failures integer NOT NULL DEFAULT 0,    -- sent in vain in a row: a device gone is forgotten
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS i_push_subscriptions_user ON public.push_subscriptions (id_user);
