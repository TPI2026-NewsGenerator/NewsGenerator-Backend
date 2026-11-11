-- The words that name a KIND of club or association ("FA", "FC", "AS"...) were organisations of their own (11.11.2026, see acronymsOf in mentions.js)

-- 1. the bare "FA" and "Football Association": the English association first among the items a card may choose (Wikidata offered a badge of Wikipedia
--    and a village of the Aude for "FA"). Nothing else is changed: they stay with no item of their own
UPDATE mentions SET candidates = jsonb_build_array('Q9500') || COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(candidates) v WHERE v <> '"Q9500"'::jsonb), '[]'::jsonb)
WHERE kind = 'organization' AND key IN ('fa', 'football association') AND qid IS NULL;

-- 2. three of them were linked to an item that is not them: FC to the concept "association football club" (67 487 news), RC to RC Strasbourg
--    (5 106 news of RC Lens, RC Vannes...), IF to a Faroese club (476 news of Brøndby IF, Silkeborg IF...)
UPDATE mentions SET qid = NULL WHERE kind = 'organization' AND qid IS NOT NULL
  AND ((name = 'FC' AND qid = 'Q476028') OR (name = 'RC' AND qid = 'Q126334') OR (name = 'IF' AND qid = 'Q291719'));

-- 3. OPTIONAL. The 88782 links of the news to these words, when the same news names the longer name they came from. The news leave the base in 30 days
--    with their links: this makes the cards clean at once. Run it alone, it takes a minute or two
-- DELETE FROM article_mentions am USING mentions bare
-- WHERE am.id_mention = bare.id AND bare.kind = 'organization' AND bare.name IN ('FA', 'FC', 'AS', 'SC', 'AC', 'CF', 'SV', 'RC', 'FK', 'IF', 'FF', 'IK', 'UD') AND bare.key = lower(bare.name)
--   AND EXISTS (SELECT 1 FROM article_mentions o JOIN mentions m ON m.id = o.id_mention WHERE o.id_article = am.id_article AND m.kind = 'organization' AND m.id <> bare.id AND m.name ~ ('(^|[^A-Za-z])' || bare.name || '([^A-Za-z]|$)'));
