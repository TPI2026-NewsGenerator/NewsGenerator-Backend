// 100 names looked for in Wikidata already (so the answer of the production path is known: mentions.qid,
// null when none or several were called so), met by 3 news or more, drawn at random: 40 persons in full and
// 20 places that the title of an article does not find (the others are linked by title since 22.10.2026, see
// services/utils/title-links.js), 40 organisations (all go name by name). Each with 3 titles of its news.
// node --env-file=.env bench/wiki-search/sample.mjs
import fs from 'node:fs';
import {prisma} from '../../config/db.js';
import {articlesOf} from '../../services/utils/title-links.js';
import {familyName} from '../../services/utils/person-items.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {MentionModel} from '../../models/mention-model.js';

const draw = async (kind, n) => prisma.$queryRawUnsafe(`
    SELECT id, name, kind, lang, seen, qid, candidates FROM mentions
    WHERE kind = $1 AND linked_at IS NOT NULL AND seen >= 3 AND length(name) BETWEEN 4 AND 60
    ORDER BY random() LIMIT $2`, kind, n);

const persons = (await draw('person', 400)).filter(row => mentionKey(row.name).includes(' ') && !familyName(row.name));
const places = await draw('location', 300);
const organizations = await draw('organization', 60);

// the ones the title of an article does not find (or only a page of homonyms)
const missing = async (rows) => {
    const found = await articlesOf(rows);
    return rows.filter(row => !found.has(row.id) || found.get(row.id).disambiguation);
};
const sample = [...(await missing(persons)).slice(0, 40), ...(await missing(places)).slice(0, 20), ...organizations.slice(0, 40)];
for (const row of sample) row.titles = await MentionModel.titlesNaming(row.id, 3);
fs.writeFileSync(new URL('./sample.json', import.meta.url), JSON.stringify(sample, null, 1));
const by = {};
for (const row of sample) by[row.kind] = (by[row.kind] ?? 0) + 1;
console.log(sample.length, by, 'with a qid from Wikidata:', sample.filter(row => row.qid).length);
await prisma.$disconnect();
