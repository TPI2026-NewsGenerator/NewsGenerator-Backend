--
--  Author: Fabian Rostello
--  Date: 27.09.2026
--  File: add_feed_failures.sql
--  Description: How many refreshes of a feed failed in a row: a source is shown as not working only
--               once it failed several times (see listUserFeeds in models/feed-model.js)
--

-- one failure is often the site slow while every feed is read at once, not a dead feed
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0;
