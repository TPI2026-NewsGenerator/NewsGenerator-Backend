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
-- 12.11.2026, when a signal last changed (its second reading, a rule of the guide read again, more news telling it). GET /api/v1/fifa/news goes on from it, so
-- that a passage that settled after the other party read it comes again with its new reading. The table of the first run gets the column (every signal at the
-- time of the migration: a first call of the other party still gives all of them)
ALTER TABLE public.fifa_signals ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS i_fifa_signals_updated ON public.fifa_signals (updated_at, id);

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
-- 12.11.2026, the source a reader joins to a choice (the link of the page that says it): shown on the sheet and read by the AI, which says whether the page SAYS the
-- choice, says the OTHER thing, or does not say it clearly. It informs and decides nothing: the choice of the reader is what colours the map
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '';
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS source_medium text NOT NULL DEFAULT '';
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS source_check text NOT NULL DEFAULT '';
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS source_found text NOT NULL DEFAULT '';
ALTER TABLE public.fifa_votes ADD COLUMN IF NOT EXISTS source_checked_at timestamp with time zone;
ALTER TABLE public.fifa_votes DROP CONSTRAINT IF EXISTS fifa_votes_source_check_check;
ALTER TABLE public.fifa_votes ADD CONSTRAINT fifa_votes_source_check_check CHECK (source_check IN ('', 'pending', 'says', 'contradicts', 'unclear', 'unreadable'));
CREATE INDEX IF NOT EXISTS i_fifa_votes_source_pending ON public.fifa_votes (id) WHERE source_check = 'pending';

-- 12.11.2026, the notes of the readers on an association: a word visible to every signed-in reader on its sheet, added by any reader, taken off by its author or an administrator
CREATE TABLE IF NOT EXISTS public.fifa_notes (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    member_qid text NOT NULL,
    text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS i_fifa_notes_member ON public.fifa_notes (member_qid, created_at DESC);

-- 12.11.2026, the candidates the news name: the map adds one by itself when two readings of the news say a person is a candidate for the presidency of FIFA.
-- origin: "seed" (the president in office, put there by this file), "reader" (a reader added the person), "news" (found in the news; found = what was found:
-- status, articles, media, the words); a candidate taken off the map (by a reader, or an administrator for the president in office) is remembered in fifa_dismissed so that the news do not bring the person back
ALTER TABLE public.fifa_subjects ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'reader';
ALTER TABLE public.fifa_subjects DROP CONSTRAINT IF EXISTS fifa_subjects_origin_check;
ALTER TABLE public.fifa_subjects ADD CONSTRAINT fifa_subjects_origin_check CHECK (origin IN ('seed', 'reader', 'news'));
ALTER TABLE public.fifa_subjects ADD COLUMN IF NOT EXISTS found jsonb;
UPDATE public.fifa_subjects SET origin = 'seed' WHERE status = 'incumbent' AND created_by IS NULL AND origin = 'reader';
CREATE TABLE IF NOT EXISTS public.fifa_dismissed (
    qid text PRIMARY KEY,
    dismissed_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 13.11.2026, a source a reader adds on its own, with no candidate (a page about an association): the AI reads it for every candidate of the map as it reads the news; the
-- signals it gives are kept in fifa_signals (source_id) and count like the ones of the news, and go with the source when it is taken off. readings: what the page says, for
-- the sheet ([{subject_qid, stance, level, found}]). state: pending (not read yet), says (a reading is established), unclear, unreadable
CREATE TABLE IF NOT EXISTS public.fifa_sources (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    member_qid text NOT NULL,
    url text NOT NULL,
    medium text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'says', 'unclear', 'unreadable')),
    readings jsonb NOT NULL DEFAULT '[]'::jsonb,
    checked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, member_qid, url)
);
CREATE INDEX IF NOT EXISTS i_fifa_sources_member ON public.fifa_sources (member_qid, created_at DESC);
CREATE INDEX IF NOT EXISTS i_fifa_sources_pending ON public.fifa_sources (id) WHERE state = 'pending';
ALTER TABLE public.fifa_signals ADD COLUMN IF NOT EXISTS source_id integer REFERENCES public.fifa_sources(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS i_fifa_signals_source ON public.fifa_signals (source_id) WHERE source_id IS NOT NULL;

-- 13.11.2026, the summary the AI writes of the sheet of an association when a reader asks (the summary of the code is not stored: it is built at each reading). claims:
-- [{text, facts: [ids]}] each citing the numbered facts it rests on (facts: [{id, kind, text, url?, medium?, date?}], kept with it so that the page can show them); input_hash: what the
-- facts were, so that a sheet that changed since makes the summary "older"; one for each association, the latest
CREATE TABLE IF NOT EXISTS public.fifa_summaries (
    member_qid text PRIMARY KEY,
    claims jsonb NOT NULL,
    facts jsonb NOT NULL,
    model text NOT NULL,
    input_hash text NOT NULL,
    created_by integer REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

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
