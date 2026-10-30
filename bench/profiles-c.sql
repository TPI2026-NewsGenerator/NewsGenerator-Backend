SET lock_timeout = '5s';
-- ===== C. Swap the keys (right before the deploy) =====

BEGIN;
-- a reader has several profiles: the key is the profile
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY USING INDEX u_user_profiles_id;

-- deleting a profile deletes its interests, sources and briefings, as deleting a reader does
ALTER TABLE public.profile_interests ADD CONSTRAINT fk_profile_interests_profile
    FOREIGN KEY (id_profile) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.user_feeds ADD CONSTRAINT fk_user_feeds_profile
    FOREIGN KEY (id_profile) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.briefings ADD CONSTRAINT fk_briefings_profile
    FOREIGN KEY (id_profile) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_interests ALTER COLUMN id_profile SET NOT NULL;
ALTER TABLE public.briefings ALTER COLUMN id_profile SET NOT NULL;

-- a source may be in two profiles of one reader (once per profile: u_user_feeds_profile). The sources
-- of a reader who never wrote a profile have none: they stay, without a profile, until one is written
ALTER TABLE public.user_feeds DROP CONSTRAINT IF EXISTS u_user_feeds;
COMMIT;
