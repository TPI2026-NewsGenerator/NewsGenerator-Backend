//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: measure.mjs
//  Description: Names in Korean, Japanese and Chinese letters never linked to Wikidata (defect 2 of the 11.11.2026 audit, see the decision log). Takes a
//               sample of the persons of the database the queue of the link now reaches (a name in full with no space: isFullName), seen 3 times or
//               more, and links them as the loop does: by the title of their article (linkedByTitle), then by the search of Wikidata (linkPerson).
//               Prints what each name became to be read by hand, and writes the same in bench/data/cjk-names/measure.json. Read-only on the
//               database; asks Wikipedia and Wikidata (about 2 calls a name) and, for an item in no Wikipedia, the AI.
//
//               node bench/cjk-names/measure.mjs [names per script, 70]
//

import 'dotenv/config';
import {mkdirSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {isFullName} from '../../services/utils/mentions.js';
import {linkedByTitle} from '../../services/utils/title-links.js';
import {linkPerson} from '../../services/utils/person-items.js';
import {describeItems} from '../../services/utils/wikidata.js';
import {newUsage} from '../../services/utils/ollama.js';

const PER_SCRIPT = Number(process.argv[2] ?? 70);
const SCRIPTS = {
    hangul: '[\\uac00-\\ud7af]',
    kana: '[\\u3040-\\u30ff]',
    han: '[\\u3400-\\u9fff]',
};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const usage = newUsage();
const result = {};

for (const [script, pattern] of Object.entries(SCRIPTS)) {
    const where = script === 'han' ? `name ~ '${pattern}' AND name !~ '[\\u3040-\\u30ff\\uac00-\\ud7af]'`
        : script === 'kana' ? `name ~ '${pattern}' AND name !~ '[\\uac00-\\ud7af]'` : `name ~ '${pattern}'`;
    const all = await prisma.$queryRawUnsafe(`SELECT id, name, kind, lang, seen, qid, linked_at AS "linkedAt" FROM mentions WHERE kind = 'person' AND seen >= 3 AND ${where} ORDER BY random()`);
    const reached = all.filter(row => isFullName(row.name));
    const rows = reached.slice(0, PER_SCRIPT);
    console.log(`\n=== ${script}: ${all.length} persons seen 3 times or more, ${reached.length} reached by the queue, ${rows.length} measured`);
    const byTitle = await linkedByTitle(rows).catch(err => { console.error('titles failed:', err.message); return new Map(); });
    const found = rows.map(row => ({...row, via: byTitle.has(row.id) ? 'title' : null, linked: byTitle.get(row.id) ?? null, candidates: []}));
    for (const row of found.filter(row => !row.via)) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const {qid, candidates} = await linkPerson(row, usage);
                row.linked = qid;
                row.candidates = candidates;
                if (qid) row.via = 'search';
                break;
            } catch (err) {
                if (err.paused) await wait(err.retryIn || 30e3);
                else { console.error(`"${row.name}":`, err.message); break; }
            }
        }
    }
    const qids = [...new Set(found.map(row => row.linked).filter(Boolean))];
    const described = new Map();
    for (let i = 0; i < qids.length; i += 50) for (const item of await describeItems(qids.slice(i, i + 50), {batch: 50})) described.set(item.qid, item);
    for (const row of found) Object.assign(row, {label: described.get(row.linked)?.label ?? null, description: described.get(row.linked)?.description ?? null, links: described.get(row.linked)?.links ?? null});
    result[script] = {persons: all.length, reached: reached.length, measured: rows.length, found};
    const linked = found.filter(row => row.linked);
    console.log(`linked ${linked.length} of ${found.length} (${found.filter(row => row.via === 'title').length} by title, ${found.filter(row => row.via === 'search').length} by search); with candidates but none chosen: ${found.filter(row => !row.linked && row.candidates.length).length}`);
    console.table(linked.map(row => ({name: row.name, seen: row.seen, via: row.via, label: row.label, description: String(row.description ?? '').slice(0, 55), links: row.links})));
    console.log('left:', found.filter(row => !row.linked).map(row => `${row.name}${row.candidates.length ? `(${row.candidates.length})` : ''}`).join(' '));
}
mkdirSync(new URL('../data/cjk-names/', import.meta.url), {recursive: true});
writeFileSync(new URL('../data/cjk-names/measure.json', import.meta.url), JSON.stringify(result, null, 1));
console.log(`\nAI calls: ${usage.calls}`);
await prisma.$disconnect();
process.exit(0);
