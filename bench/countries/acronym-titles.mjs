// The titles of the news that write an acronym of an association, to judge by eye whether the association is the one meant. Read only.
//   node --env-file=.env bench/countries/acronym-titles.mjs CSA FSF FSM [titles each]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {MentionModel} from '../../models/mention-model.js';
import {mediaOf} from '../../services/utils/country-names.js';
import {associationOfAcronym, associationsOfAcronym} from '../../services/utils/football-associations.js';

const args = process.argv.slice(2);
const each = /^\d+$/.test(args.at(-1) ?? '') ? Number(args.pop()) : 6;
for (const name of args) {
    const rows = await prisma.$queryRawUnsafe(`SELECT id FROM mentions WHERE kind = 'organization' AND qid IS NULL AND name = $1 ORDER BY seen DESC LIMIT 1`, name);
    if (rows.length === 0) { console.log(`${name}: no organisation with no item`); continue; }
    const country = mediaOf(await MentionModel.sitesNaming(rows[0].id)).country;
    const qid = associationOfAcronym(name, country);
    console.log(`\n== ${name}  sites' country: ${country ?? '-'}  rule: ${qid ? associationsOfAcronym(name).find(item => item.qid === qid).name : 'none'}`);
    for (const title of await MentionModel.titlesNaming(rows[0].id, each)) console.log(`   - ${title.slice(0, 150)}`);
}
await prisma.$disconnect();
