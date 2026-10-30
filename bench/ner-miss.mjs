// the news naming a name in their text the tagger did not give: where the name is, what it found
import pg from 'pg';
import {Filter} from '../services/utils/filter.js';
import {richText} from '../services/ingest-service.js';
const name = process.argv[2] ?? 'Čeferin';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`
    SELECT a.id, a.lang, a.title, a.description, COALESCE(array_agg(m.name || ' [' || m.kind || ']') FILTER (WHERE m.key IS NOT NULL), '{}') AS names
    FROM articles a LEFT JOIN article_mentions am ON am.id_article = a.id LEFT JOIN mentions m ON m.id = am.id_mention
    WHERE a.entities_at IS NOT NULL AND a.search_text ILIKE $1 GROUP BY a.id LIMIT 400`, [`%${Filter.withoutAccents(name).toLowerCase()}%`]);
const inText = Filter.matcher(Filter.parse([`"${name}"`]));
let shown = 0, inRead = 0, total = 0;
for (const r of rows) {
    if (!inText(`${r.title} ${r.description ?? ''}`)) continue;
    total++;
    const read = richText(r.title, r.description);
    const within = inText(read);
    if (within) inRead++;
    if (shown++ < 8) console.log(`[${r.lang}] ${within ? 'READ' : 'beyond 400'} | ${read.slice(0, 160)}\n      -> ${r.names.join(', ')}`);
}
console.log(`${total} name it in their text, ${inRead} in what the tagger reads`);
await c.end();
