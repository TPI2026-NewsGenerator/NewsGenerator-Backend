// What linking the acronyms of the football associations reaches: the organisations of the database with no item whose name is the acronym of an association
// (the ones Wikidata has and the initials of its name, see football-associations.js associationOfAcronym), by name, with the associations that share it, the country of
// the sites that name it and what the rule decides. Read only.   node --env-file=.env bench/countries/acronym-gain.mjs [rows shown]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {mediaOf} from '../../services/utils/country-names.js';
import {associationOfAcronym, associationsOfAcronym} from '../../services/utils/football-associations.js';
import {MentionModel} from '../../models/mention-model.js';

const names = await prisma.$queryRawUnsafe(`SELECT m.id, m.name, count(DISTINCT am.id_article)::int AS articles FROM mentions m JOIN article_mentions am ON am.id_mention = m.id
    WHERE m.kind = 'organization' AND m.qid IS NULL GROUP BY m.id, m.name ORDER BY 3 DESC`);
const rows = names.filter(row => associationsOfAcronym(row.name).length > 0);
console.log(`${rows.length} organisations with no item bear the acronym of an association, ${rows.reduce((sum, row) => sum + row.articles, 0)} article-mentions`);
let taken = 0, takenNews = 0, offered = 0, offeredNews = 0, left = 0, leftNews = 0;
for (const [i, row] of rows.entries()) {
    const country = mediaOf(await MentionModel.sitesNaming(row.id)).country;
    const qid = associationOfAcronym(row.name, country);
    const stands = associationsOfAcronym(row.name);
    // what organizationItem does: taken at once with a country of sites that matches, offered to the card that chooses (never taken) with no country
    if (qid && country) { taken++; takenNews += row.articles; } else if (qid) { offered++; offeredNews += row.articles; } else { left++; leftNews += row.articles; }
    if (i < Number(process.argv[2] ?? 40)) {
        console.log(`  ${row.name.padEnd(8)} ${String(row.articles).padStart(4)} news  sites' country: ${(country ?? '-').padEnd(2)}  -> ${qid ? `${qid} ${stands.find(item => item.qid === qid).name.slice(0, 42)}` : 'none'.padEnd(10)}  (${stands.map(item => item.country).join('/')})`);
    }
}
console.log(`taken at once (country of the sites matches): ${taken} names, ${takenNews} article-mentions`);
// with --sql: the relink of the organisations already in the database that organizationItem now takes at once (the ones it offers or leaves are not touched)
if (process.argv.includes('--sql')) {
    const values = [];
    for (const row of rows) {
        const country = mediaOf(await MentionModel.sitesNaming(row.id)).country;
        const qid = country ? associationOfAcronym(row.name, country) : null;
        if (qid) values.push(`(${row.id}, '${qid}')`);
    }
    console.log(`\n-- ${values.length} acronyms of an association with no item (11.11.2026), the sites naming each of the country of that association: linked to it (football-associations.js associationOfAcronym; the ones met rarely wait for the link loop, the ones looked for in Wikidata were left with none)\nUPDATE mentions m SET qid = v.qid, linked_at = now() FROM (VALUES ${values.join(', ')}) AS v(id, qid) WHERE m.id = v.id AND m.qid IS NULL;`);
}
console.log(`unique acronym, no country of sites (offered to the card that chooses, not linked): ${offered} names, ${offeredNews} article-mentions`);
console.log(`left as before (sites of another country, or several associations): ${left} names, ${leftNews} article-mentions`);
await prisma.$disconnect();
