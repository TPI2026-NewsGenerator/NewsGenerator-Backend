// The acronyms inside the names of the news tagged before acronymsOf (13.10.2026), added from the names
// stored: node --env-file=.env bench/acronyms-backfill.mjs
import {MentionModel} from '../models/mention-model.js';
import {cleanMentions} from '../services/utils/mentions.js';
import {prisma} from '../config/db.js';
const rows = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.lang, array_agg(json_build_object('text', m.name, 'label', m.kind, 'key', m.key)) AS names
    FROM articles a JOIN article_mentions am ON am.id_article = a.id JOIN mentions m ON m.id = am.id_mention
    WHERE a.entities_at IS NOT NULL GROUP BY a.id`);
const added = rows.map(row => {
    const known = new Set(row.names.map(name => `${name.label} ${name.key}`));
    return {id: row.id, lang: row.lang, names: cleanMentions(row.names).filter(name => !known.has(`${name.kind} ${name.key}`))};
}).filter(row => row.names.length > 0);
console.log(`${added.length} news get ${added.reduce((sum, row) => sum + row.names.length, 0)} acronyms`);
for (let i = 0; i < added.length; i += 200) await MentionModel.save(added.slice(i, i + 200));
await prisma.$disconnect();
process.exit(0);
