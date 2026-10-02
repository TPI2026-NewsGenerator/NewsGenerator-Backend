-- The themes a reader ticked with their profile ("sport", "science") went to the AI as one line next
-- to their text, which already said them: the interests are read from the text alone. Their column
-- goes (the code no longer reads it, see services/profile-service.js)
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS topics;
