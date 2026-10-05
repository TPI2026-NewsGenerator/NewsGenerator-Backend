--
--  Author: Fabian Rostello
--  Date: 27.09.2026
--  File: add_feed_failures.sql
--  Description: How many refreshes of a feed failed in a row: a source is shown as not working only
--               once it failed several times (see listUserFeeds in models/feed-model.js). And when it
--               last worked: failing for days, it is read once a day (see readEvery in
--               services/ingest-service.js)
--

-- one failure is often the site slow while every feed is read at once, not a dead feed
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;

-- the last refresh that worked (an answer "not modified" too). The feeds there before this column
-- take the time it was added: a feed failing already is counted from then (5.10.2026)
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS last_success_at timestamptz NOT NULL DEFAULT now();
