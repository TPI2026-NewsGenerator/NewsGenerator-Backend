-- The hours of news a briefing was written from, chosen by the reader (24, 48 or 168, see
-- briefing-service.js): the page says it, and the next briefing is asked the same way by default
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS hours integer NOT NULL DEFAULT 48;
