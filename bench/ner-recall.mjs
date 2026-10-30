// On the news tagged, the ones naming a name as a whole word of their text vs the ones whose names
// (the tagger's) hold it: what the entity page finds now against before. node --env-file=.env bench/ner-recall.mjs
import pg from 'pg';
import {Filter} from '../services/utils/filter.js';
import {mentionKey} from '../services/utils/mentions.js';
import {richText} from '../services/ingest-service.js';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`
    SELECT a.id, a.title, a.description, COALESCE(array_agg(m.key) FILTER (WHERE m.key IS NOT NULL), '{}') AS keys
    FROM articles a LEFT JOIN article_mentions am ON am.id_article = a.id LEFT JOIN mentions m ON m.id = am.id_mention
    WHERE a.entities_at IS NOT NULL GROUP BY a.id`);
console.log(`${rows.length} news tagged`);
// as an entity page asks them: an item's names, the family name of a person among them
const items = {UEFA: ['UEFA', 'Union of European Football Associations'], FIFA: ['FIFA', 'Fédération Internationale de Football Association'],
    Infantino: ['Gianni Infantino', 'Infantino'], Ceferin: ['Aleksander Čeferin', 'Čeferin'], LFF: ['LFF', 'Latvian Football Federation', 'Latvijas Futbola federācija'],
    'Nations League': ['UEFA Nations League', 'Nations League']};
for (const [item, names] of Object.entries(items)) {
    const matchers = names.map(name => Filter.matcher(Filter.parse([`"${name}"`])));
    const keys = names.map(mentionKey);
    const all = rows.filter(r => matchers.some(m => m(`${r.title} ${r.description ?? ''}`)));
    // what the tagger reads: the title and 400 characters of the description
    const text = rows.filter(r => matchers.some(m => m(richText(r.title, r.description))));
    const tagged = rows.filter(r => r.keys.some(k => keys.includes(k)));
    const both = text.filter(r => r.keys.some(k => keys.includes(k)));
    console.log(`${item}: whole text ${all.length}, read text ${text.length}, tagger ${tagged.length}, both ${both.length}`);
    text.filter(r => !r.keys.some(k => keys.includes(k))).slice(0, 3)
        .forEach(r => console.log(`   missed: ${r.title.slice(0, 80)} -> [${r.keys.join(', ').slice(0, 120)}]`));
    tagged.filter(r => !text.includes(r)).slice(0, 2)
        .forEach(r => console.log(`   only tagger: ${r.title.slice(0, 80)}`));
}
await c.end();
