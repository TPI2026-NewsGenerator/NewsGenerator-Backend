--
--  Author: Fabian Rostello
--  Date: 25.09.2026
--  File: add_trusted_sources.sql
--  Description: The sources a reader trusts, and the ones they keep although their thumbs left them out
--

-- a source added by hand the reader trusts: among the stories already close to the profile, the ones
-- it tells come first, and its article leads the card. It changes nothing to the corroboration
ALTER TABLE public.user_feeds ADD COLUMN IF NOT EXISTS trusted boolean NOT NULL DEFAULT false;

-- the feeds a reader chose to keep after their thumbs left them out (see services/utils/feedback.js):
-- never left out again
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS kept_sources text[] NOT NULL DEFAULT '{}';
