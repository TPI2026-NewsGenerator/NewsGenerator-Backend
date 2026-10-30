SET lock_timeout = '5s';
-- ===== B. Fill: what a reader had goes to their one profile =====
-- (run again after the deploy if the server of before saved rows in between: it only fills what is empty)

UPDATE public.profile_interests i SET id_profile = p.id
FROM public.user_profiles p WHERE p.id_user = i.id_user AND i.id_profile IS NULL;
UPDATE public.user_feeds uf SET id_profile = p.id
FROM public.user_profiles p WHERE p.id_user = uf.id_user AND uf.id_profile IS NULL;
UPDATE public.briefings b SET id_profile = p.id
FROM public.user_profiles p WHERE p.id_user = b.id_user AND b.id_profile IS NULL;

