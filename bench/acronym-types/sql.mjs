//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: sql.mjs
//  Description: The words that name a KIND of club or association ("FA", "FC", "AS"...) were added as organisations of their own by acronymsOf (see
//               mentions.js and bench/acronym-types/measure.mjs). What is already in the base, for the user to run on srv1 (kinds-of-club.sql):
//                 1. the bare "FA" and "Football Association" get the English association first among the items a card may choose;
//                 2. the three of these words linked to a wrong item (FC: the concept "association football club", RC: RC Strasbourg, IF: a Faroese
//                    club) lose it: 73 069 news were said to name them;
//                 3. OPTIONAL: the links of the news to these words, when the same news names the longer name they came from. The news age out
//                    in 30 days with them; the delete only makes the cards clean at once.
//               Counts first, read-only.
//
//               node bench/acronym-types/sql.mjs
//

import 'dotenv/config';
import {writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';

const WORDS = ['FA', 'FC', 'AS', 'SC', 'AC', 'CF', 'SV', 'RC', 'FK', 'IF', 'FF', 'IK', 'UD'];
const LIST = WORDS.map(word => `'${word}'`).join(', ');
const COME_FROM = `EXISTS (SELECT 1 FROM article_mentions o JOIN mentions m ON m.id = o.id_mention
                  WHERE o.id_article = am.id_article AND m.kind = 'organization' AND m.id <> bare.id
                    AND m.name ~ ('(^|[^A-Za-z])' || bare.name || '([^A-Za-z]|$)'))`;
const [wrong] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS names, coalesce(sum(seen), 0)::int AS seen FROM mentions
    WHERE kind = 'organization' AND name IN ('FC', 'RC', 'IF') AND qid IN ('Q476028', 'Q126334', 'Q291719')`);
console.log('links of the kinds of club to a wrong item:', wrong);
const started = Date.now();
const [artifacts] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS links FROM article_mentions am JOIN mentions bare ON bare.id = am.id_mention
    WHERE bare.kind = 'organization' AND bare.name IN (${LIST}) AND bare.key = lower(bare.name) AND ${COME_FROM}`);
console.log(`links news -> bare kind of club that come from a longer name: ${artifacts.links} (${Date.now() - started} ms)`);

writeFileSync(new URL('./kinds-of-club.sql', import.meta.url), [
    `-- The words that name a KIND of club or association ("FA", "FC", "AS"...) were organisations of their own (11.11.2026, see acronymsOf in mentions.js)`,
    ``,
    `-- 1. the bare "FA" and "Football Association": the English association first among the items a card may choose (Wikidata offered a badge of Wikipedia`,
    `--    and a village of the Aude for "FA"). Nothing else is changed: they stay with no item of their own`,
    `UPDATE mentions SET candidates = jsonb_build_array('Q9500') || COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(candidates) v WHERE v <> '"Q9500"'::jsonb), '[]'::jsonb)`,
    `WHERE kind = 'organization' AND key IN ('fa', 'football association') AND qid IS NULL;`,
    ``,
    `-- 2. three of them were linked to an item that is not them: FC to the concept "association football club" (67 487 news), RC to RC Strasbourg`,
    `--    (5 106 news of RC Lens, RC Vannes...), IF to a Faroese club (476 news of Brøndby IF, Silkeborg IF...)`,
    `UPDATE mentions SET qid = NULL WHERE kind = 'organization' AND qid IS NOT NULL`,
    `  AND ((name = 'FC' AND qid = 'Q476028') OR (name = 'RC' AND qid = 'Q126334') OR (name = 'IF' AND qid = 'Q291719'));`,
    ``,
    `-- 3. OPTIONAL. The ${artifacts.links} links of the news to these words, when the same news names the longer name they came from. The news leave the base in 30 days`,
    `--    with their links: this makes the cards clean at once. Run it alone, it takes a minute or two`,
    `-- DELETE FROM article_mentions am USING mentions bare`,
    `-- WHERE am.id_mention = bare.id AND bare.kind = 'organization' AND bare.name IN (${LIST}) AND bare.key = lower(bare.name)`,
    `--   AND ${COME_FROM.replace(/\n\s*/g, ' ')};`,
    ``,
].join('\n'));
await prisma.$disconnect();
