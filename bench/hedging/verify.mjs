// The words of hedging.js read on the real news of the last 14 days, language by language: how many of the news of the language hold a hedge,
// which words, and a few of the places they were found in, to read with one's own eyes (a word is right when the article says it has no
// confirmation, not when it only says something is alleged in a crime report, denied or confirmed). Also the words found in the news of
// ANOTHER language than the one they are listed in: a word that is an ordinary word elsewhere. Read only.
//   node --env-file=.env bench/hedging/verify.mjs "<languages, comma separated>" [sample per language=30000] [contexts per word=2] [words per language=8]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {hedgedBy, WORDS} from '../../services/utils/hedging.js';

const languages = (process.argv[2] ?? '').split(',').map(code => code.trim()).filter(Boolean);
const sample = Number(process.argv[3] ?? 30000);
const contexts = Number(process.argv[4] ?? 2);
const shown = Number(process.argv[5] ?? 8);

const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// the language each word is listed in
const listedIn = new Map();
for (const [language, {said, rumour}] of Object.entries(WORDS)) for (const marked of [...said, ...rumour]) { const word = marked.replace(/^\||\|$/g, '').toLowerCase(); listedIn.set(word, [...(listedIn.get(word) ?? []), language]); }

for (const language of languages) {
    const rows = await prisma.$queryRawUnsafe(
        `SELECT title, left(description, 1500) AS description FROM articles
         WHERE COALESCE(published_at, created_at) >= now() - interval '14 days' AND lang = $1 ORDER BY random() LIMIT $2`, language, sample);
    const hits = new Map();
    let hedged = 0;
    for (const row of rows) {
        const found = hedgedBy(row.title, squash(row.description));
        if (!found) continue;
        hedged++;
        const one = hits.get(found) ?? {n: 0, examples: []};
        one.n++;
        if (one.examples.length < contexts) {
            const text = `${squash(row.title)} || ${squash(row.description)}`;
            const at = text.toLowerCase().indexOf(found);
            one.examples.push(`…${text.slice(Math.max(0, at - 55), at + found.length + 45)}…`);
        }
        hits.set(found, one);
    }
    console.log(`\n## ${language}: ${rows.length} news read, hedged ${hedged} = ${(100 * hedged / Math.max(1, rows.length)).toFixed(2)}%`);
    for (const [word, one] of [...hits].sort((a, b) => b[1].n - a[1].n).slice(0, shown)) {
        const elsewhere = listedIn.get(word)?.includes(language) ? '' : ` [listed in ${(listedIn.get(word) ?? ['?']).join(',')}]`;
        console.log(`  ${word} ${one.n}${elsewhere}`);
        for (const example of one.examples) console.log(`      ${example}`);
    }
}
await prisma.$disconnect();
