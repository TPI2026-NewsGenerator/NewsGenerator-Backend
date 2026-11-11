// The names of the countries in the languages country-names.js does not read yet (Intl knows them all): how many mentions of the database have
// one as their name, by kind, and which. Read only.   node --env-file=.env bench/countries/new-names.mjs
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {countryNamed} from '../../services/utils/country-names.js';

const NEW = ['fa', 'th', 'hi', 'bn', 'ur', 'ta', 'te', 'mr', 'ne', 'si', 'km', 'lo', 'my', 'am', 'kn', 'ml', 'gu', 'pa', 'ps', 'ky', 'tg', 'mn'];
const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const codes = letters.flatMap(a => letters.map(b => a + b));
const keys = new Map();
for (const language of NEW) for (const style of ['long', 'short']) {
    const display = new Intl.DisplayNames([language], {type: 'region', style, fallback: 'none'});
    for (const code of codes) {
        const name = display.of(code);
        if (!name || name === code || ['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'].includes(code)) continue;
        const key = mentionKey(name);
        if (key.length >= 2 && !countryNamed(name)) keys.set(key, {code, name, language});
    }
}
console.log(`${keys.size} names of countries in ${NEW.length} languages that countryNamed does not know yet`);
const rows = await prisma.$queryRawUnsafe(`SELECT m.key, m.kind, count(*)::int AS articles FROM mentions m JOIN article_mentions am ON am.id_mention = m.id WHERE m.key = ANY($1::text[]) GROUP BY m.key, m.kind ORDER BY 3 DESC LIMIT 40`, [...keys.keys()]);
const total = {};
for (const row of rows) total[row.kind] = (total[row.kind] ?? 0) + row.articles;
console.log('articles naming one of them, by kind of mention:', JSON.stringify(total));
for (const row of rows.slice(0, Number(process.argv[2] ?? 28))) { const k = keys.get(row.key); console.log(`  ${row.key.padEnd(18)} ${k.code} ${k.language.padEnd(3)} ${row.kind.padEnd(13)} ${row.articles}`); }
await prisma.$disconnect();
