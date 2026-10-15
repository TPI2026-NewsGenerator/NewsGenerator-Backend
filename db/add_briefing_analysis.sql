-- The analysis on top of a briefing, written by the AI after its cards (see briefing-analysis.js):
-- {status: 'running' | 'ready' | 'failed', startedAt, model, changed, risks, dropped}, null for the
-- briefings written before 15.10.2026
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS analysis jsonb;
