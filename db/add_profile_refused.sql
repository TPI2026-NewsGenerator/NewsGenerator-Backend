-- What a reader says they do not want ("pas le football féminin") is never an interest: its vector
-- would bring those news. The AI gives it apart when it splits the profile, kept here to show the
-- reader it was read (the choice and the review of a briefing read it in the text itself). Filled when
-- a profile is saved again
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS refused text[] NOT NULL DEFAULT '{}';
