//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: relink.mjs
//  Description: Names in Korean, Japanese and Chinese letters (defect 2 of the 11.11.2026 audit): the persons looked for in Wikidata and left with no item
//               before the fix were looked for as a word alone, in English: put back in the queue of the link (linked_at NULL) for the user to run
//               on srv1. And, as a second file to run or not, the Japanese news of the last 30 days tagged before the cut of the text at the changes of
//               alphabet (see tagger.js withScriptBreaks): their names are given again by the tagger (they were clauses). Counts first, read-only.
//
//               node bench/cjk-names/relink.mjs      writes relink.sql and retag-japanese.sql here
//

import 'dotenv/config';
import {writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {UNSPACED_FULL_NAME_SQL} from '../../services/utils/mentions.js';

const CJK = `name ~ '[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af]'`;
const [relink] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS names, coalesce(sum(seen), 0)::int AS seen FROM mentions
    WHERE kind = 'person' AND qid IS NULL AND linked_at IS NOT NULL AND ${CJK} AND ${UNSPACED_FULL_NAME_SQL}`);
console.log(`persons looked for and left with no item, now reached: ${relink.names} names, ${relink.seen} mentions`);
writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${relink.names} persons in Korean, Japanese or Chinese letters looked for in Wikidata and left with no item, back in the queue of the link (11.11.2026):\n`
    + `-- they were looked for as a word alone, in English (see isFullName and cjkLanguages in mentions.js)\n`
    + `UPDATE mentions SET linked_at = NULL WHERE kind = 'person' AND qid IS NULL AND linked_at IS NOT NULL AND ${CJK} AND ${UNSPACED_FULL_NAME_SQL.replace(/\n\s*/g, ' ')};\n`);

const WHERE = `a.entities_at IS NOT NULL AND a.created_at >= now() - interval '30 days' AND (a.lang = 'ja' OR (a.lang IS NULL AND a.title ~ '[\\u3040-\\u30ff]'))`;
const [japanese] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS news FROM articles a WHERE ${WHERE}`);
console.log(`Japanese news of 30 days tagged: ${japanese.news}`);
writeFileSync(new URL('./retag-japanese.sql', import.meta.url), `-- OPTIONAL. ${japanese.news} Japanese news of the last 30 days tagged before the text was cut at the changes of alphabet (11.11.2026): their names were clauses.\n`
    + `-- Their links to names are taken off and the tagger reads them again (about 2 news a second on a processor). The seen of the names they held is not taken\n`
    + `-- back (a clean name met again is counted twice); the clauses no news names any more are deleted by the housekeeping of the day.\n`
    + `BEGIN;\n`
    + `DELETE FROM article_mentions WHERE id_article IN (SELECT a.id FROM articles a WHERE ${WHERE});\n`
    + `UPDATE articles a SET entities_at = NULL WHERE ${WHERE};\n`
    + `COMMIT;\n`);
await prisma.$disconnect();
