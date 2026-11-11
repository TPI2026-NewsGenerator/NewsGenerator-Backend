// The words of statement-words.js read on the real news of the last 14 days, language by language: the share of the news of a language that holds one,
// which words, and a few places they were found in, to read with one's own eyes (a word is right when it says that a party issued a statement, a
// communiqué or a release, or says "officially"; not when it is only a common word). Read only.
//   node --env-file=.env bench/hedging/verify-statements.mjs "<languages, comma separated>" [sample per language=30000] [contexts per word=2] [words per language=8]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {statementWordOf, WORDS} from '../../services/utils/statement-words.js';
import {hasStatement} from '../../services/utils/statements.js';

const languages = (process.argv[2] ?? '').split(',').map(code => code.trim()).filter(Boolean);
const sample = Number(process.argv[3] ?? 30000);
const contexts = Number(process.argv[4] ?? 2);
const shown = Number(process.argv[5] ?? 8);
const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const listedIn = new Map();
for (const [language, words] of Object.entries(WORDS)) for (const marked of words) { const word = marked.replace(/^\||\|$/g, '').toLowerCase(); listedIn.set(word, [...(listedIn.get(word) ?? []), language]); }

for (const language of languages) {
    const rows = await prisma.$queryRawUnsafe(
        `SELECT title, left(description, 1500) AS description FROM articles
         WHERE COALESCE(published_at, created_at) >= now() - interval '14 days' AND lang = $1 ORDER BY random() LIMIT $2`, language, sample);
    const hits = new Map();
    let held = 0, before = 0;
    for (const row of rows) {
        const text = `${squash(row.title)}. ${squash(row.description)}`;
        if (hasStatement(text)) before++;
        const found = statementWordOf(text);
        if (!found) continue;
        held++;
        const one = hits.get(found) ?? {n: 0, examples: []};
        one.n++;
        if (one.examples.length < contexts) {
            const at = text.toLowerCase().indexOf(found);
            one.examples.push(`…${text.slice(Math.max(0, at - 55), at + found.length + 50)}…`);
        }
        hits.set(found, one);
    }
    console.log(`\n## ${language}: ${rows.length} news read, a word of statements.js in ${before} (${(100 * before / Math.max(1, rows.length)).toFixed(2)}%), a word added in ${held} (${(100 * held / Math.max(1, rows.length)).toFixed(2)}%)`);
    for (const [word, one] of [...hits].sort((a, b) => b[1].n - a[1].n).slice(0, shown)) {
        const elsewhere = listedIn.get(word)?.includes(language) ? '' : ` [listed in ${(listedIn.get(word) ?? ['?']).join(',')}]`;
        console.log(`  ${word} ${one.n}${elsewhere}`);
        for (const example of one.examples) console.log(`      ${example}`);
    }
}
await prisma.$disconnect();
