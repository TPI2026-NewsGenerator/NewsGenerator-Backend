--
--  Author: Fabian Rostello
--  Date: 12.11.2026
--  File: add_fifa_map.sql
--  Description: The map "The FIFA presidency": the candidates, what the news said of the position of each association on each
--               (the signals, copied when they are read since the news are purged after 30 days), the votes of the readers
--               and the presidents of the associations
--
--  Can be run again: every statement checks what already exists. Run after the tables of the users (db/ of the first setup).
--  node --env-file=.env bench/apply-sql.mjs db/add_fifa_map.sql
--

-- A candidate, or the person in office. "terms": the words of the person a sentence must hold to be read ("infantino"), made from the name
-- when the candidate is added. state "computing": the 30 days of news are being read; checked_at: the news created since are the ones to read
CREATE TABLE IF NOT EXISTS public.fifa_subjects (
    qid text PRIMARY KEY,
    name text NOT NULL,
    terms text[] NOT NULL,
    status text NOT NULL DEFAULT 'declared' CHECK (status IN ('incumbent', 'declared', 'rumoured', 'withdrawn')),
    state text NOT NULL DEFAULT 'computing' CHECK (state IN ('computing', 'ready')),
    color_index integer NOT NULL DEFAULT 1 CHECK (color_index BETWEEN 1 AND 6),
    created_by integer REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    checked_at timestamp with time zone,
    backfilled_at timestamp with time zone
);

-- One passage of the news read for one association on one candidate. Copied whole (the title, the description, the sentence) because the news
-- are purged after 30 days and the history of a position goes on. certainty: established = a position that colours; uncertain = about the election
-- and the association but not a position (badge, no colour); discarded = read and left out (kept for the count of articles, never shown).
-- A passage whose second reading failed is uncertain with reason "unconfirmed" and confirmed false: it is read again
CREATE TABLE IF NOT EXISTS public.fifa_signals (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject_qid text NOT NULL REFERENCES public.fifa_subjects(qid) ON DELETE CASCADE,
    member_qid text NOT NULL,
    hash text NOT NULL,
    certainty text NOT NULL CHECK (certainty IN ('established', 'uncertain', 'discarded')),
    uncertain_reason text NOT NULL DEFAULT '',
    stance text NOT NULL DEFAULT 'none',
    level text NOT NULL DEFAULT 'none',
    mark text NOT NULL DEFAULT 'official',
    speaker_kind text NOT NULL DEFAULT 'none',
    speaker text NOT NULL DEFAULT '',
    matched text NOT NULL DEFAULT '',
    sentence text NOT NULL,
    title text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    quote text NOT NULL DEFAULT '',
    lang text,
    url text,
    medium text,
    published_at timestamp with time zone NOT NULL,
    news_count integer NOT NULL DEFAULT 1,
    media_count integer NOT NULL DEFAULT 1,
    read_by text[] NOT NULL DEFAULT '{}',
    confirmed boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (subject_qid, member_qid, hash)
);
CREATE INDEX IF NOT EXISTS i_fifa_signals_member ON public.fifa_signals (member_qid, subject_qid);
CREATE INDEX IF NOT EXISTS i_fifa_signals_unconfirmed ON public.fifa_signals (id) WHERE certainty = 'uncertain' AND NOT confirmed;

-- The votes of the readers on the position of an association on a candidate: only added, never changed. The vote that decides is the latest
-- of each reader who has not taken it back, the newest of those (see fifa-map.js decisiveVote)
CREATE TABLE IF NOT EXISTS public.fifa_votes (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subject_qid text NOT NULL REFERENCES public.fifa_subjects(qid) ON DELETE CASCADE,
    member_qid text NOT NULL,
    value text NOT NULL CHECK (value IN ('for', 'against', 'unknown', 'withdraw', 'confirm')),
    note text NOT NULL DEFAULT '',
    seen text NOT NULL DEFAULT '',          -- for a "confirm": the position the reader saw and confirmed
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS i_fifa_votes_member ON public.fifa_votes (subject_qid, member_qid, created_at DESC);
-- 12.11.2026, the button "Confirm this position": a "confirm" records that a reader checked the position shown and keeps it as it is (it decides nothing);
-- "seen" says which position that was, so that a confirmation older than the news that changed it is told apart. The table of the first run gets the column
-- and the new word
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS seen text NOT NULL DEFAULT '';
ALTER TABLE public.fifa_votes DROP CONSTRAINT IF EXISTS fifa_votes_value_check;
ALTER TABLE public.fifa_votes ADD CONSTRAINT fifa_votes_value_check CHECK (value IN ('for', 'against', 'unknown', 'withdraw', 'confirm'));

-- The president of each association as Wikidata has it (P488), read once a day
CREATE TABLE IF NOT EXISTS public.fifa_leaders (
    member_qid text PRIMARY KEY,
    person_qid text,
    name text NOT NULL,
    role text NOT NULL DEFAULT 'President',
    since date,
    source text NOT NULL DEFAULT 'wikidata',     -- 'fifa' (the public page of the association on inside.fifa.com) or 'wikidata'
    source_url text NOT NULL DEFAULT '',
    checked_at timestamp with time zone NOT NULL DEFAULT now()
);
-- 12.11.2026: where a president comes from; the table of the first run gets the two columns
ALTER TABLE public.fifa_leaders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'wikidata';
ALTER TABLE public.fifa_leaders ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '';

-- The weekly audit of the positions shown (see fifa-audit.js): a sample of the established signals read again by a third model, and the votes of the
-- readers against the news. verdict "warning": the agreement is under the threshold
CREATE TABLE IF NOT EXISTS public.fifa_audits (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    made_at timestamp with time zone NOT NULL DEFAULT now(),
    auditor text NOT NULL,
    sampled integer NOT NULL,
    agreed integer NOT NULL,
    unreadable integer NOT NULL DEFAULT 0,
    votes_total integer NOT NULL DEFAULT 0,
    votes_contradicting integer NOT NULL DEFAULT 0,
    verdict text NOT NULL CHECK (verdict IN ('ok', 'warning', 'too_few')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- The person in office, so that the map has someone to show before a candidate is added (the others are added by an administrator, see scripts/fifa-subject.js)
INSERT INTO public.fifa_subjects (qid, name, terms, status, state, color_index)
VALUES ('Q124138', 'Gianni Infantino', ARRAY['infantino'], 'incumbent', 'computing', 1)
ON CONFLICT (qid) DO NOTHING;
