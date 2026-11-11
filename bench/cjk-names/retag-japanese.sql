-- OPTIONAL. 4509 Japanese news of the last 30 days tagged before the text was cut at the changes of alphabet (11.11.2026): their names were clauses.
-- Their links to names are taken off and the tagger reads them again (about 2 news a second on a processor). The seen of the names they held is not taken
-- back (a clean name met again is counted twice); the clauses no news names any more are deleted by the housekeeping of the day.
BEGIN;
DELETE FROM article_mentions WHERE id_article IN (SELECT a.id FROM articles a WHERE a.entities_at IS NOT NULL AND a.created_at >= now() - interval '30 days' AND (a.lang = 'ja' OR (a.lang IS NULL AND a.title ~ '[\u3040-\u30ff]')));
UPDATE articles a SET entities_at = NULL WHERE a.entities_at IS NOT NULL AND a.created_at >= now() - interval '30 days' AND (a.lang = 'ja' OR (a.lang IS NULL AND a.title ~ '[\u3040-\u30ff]'));
COMMIT;
