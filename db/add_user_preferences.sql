--
--  Author: Fabian Rostello
--  Date: 06.11.2026
--  File: add_user_preferences.sql
--  Description: The display preferences of a reader, kept on their account (the layout of the editor of the e-mail, the presets, "Show",
--               the reading way, the size of the briefing, the number of news per name followed) so that a phone and a laptop show the same
--

-- Run it before the server of this version: the login reads the whole row of an account, the new column included.
-- {} until the reader sets one: a JSON object whose keys are the ones services/utils/preferences.js accepts, written by PUT /api/account/preferences
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}';
