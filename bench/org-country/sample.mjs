// A random sample of the organisations relink.sql would ask again: what the AI answers for each against the
// item now linked (organizationItem's AI path), only the ones that change printed with their titles, to
// judge by hand. node --env-file=.env bench/org-country/sample.mjs [sample, 80]
import fs from 'node:fs';
import pg from 'pg';
import {namedItems, describeItems} from '../../services/utils/wikidata.js';
import {ollamaJson} from '../../services/utils/ollama.js';
import {organizationPrompt, MIN_SITELINKS} from '../../services/utils/organization-items.js';
import {MentionModel} from '../../models/mention-model.js';
import {prisma} from '../../config/db.js';

// asked again after a refusal of Wikidata, as the link loop waits
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 20) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
};
const SAMPLE = Number(process.argv[2] ?? 80);
const ids = fs.readFileSync(new URL('./relink.sql', import.meta.url), 'utf8').match(/ARRAY\[([\d,]+)\]/)[1].split(',').map(Number);
const pick = ids.map(id => [Math.random(), id]).sort((a, b) => a[0] - b[0]).slice(0, SAMPLE).map(([, id]) => id);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE id = ANY($1::int[])`, [pick]);
await db.end();
const out = [];
let same = 0;
for (const row of rows) {
    const found = await patient(() => namedItems(row.name, row.lang ?? 'en'));
    const exact = found.filter(item => item.exact);
    const described = await patient(() => describeItems([...new Set([row.qid, ...found.map(item => item.qid)])]));
    const items = described.filter(item => !item.human && found.some(f => f.qid === item.qid));
    const current = described.find(item => item.qid === row.qid);
    const titles = await MentionModel.titlesNaming(row.id, 5);
    if (items.length === 0 || titles.length === 0) { out.push({row, verdict: 'no items or titles', current}); continue; }
    const answer = await ollamaJson(organizationPrompt(row.name, titles, items), null);
    const chosen = items[Number(answer?.n) - 1];
    const kept = chosen && chosen.links >= (exact.length === 1 ? 1 : MIN_SITELINKS) ? chosen : null;
    if (kept?.qid === row.qid) { same++; continue; }
    out.push({row, kept, current, titles});
}
console.log(`${rows.length} asked: ${same} the same item, ${out.length} change`);
for (const {row, kept, current, titles, verdict} of out) {
    console.log(`\n${row.seen}\t${row.name} [${row.lang}]\n  now: ${row.qid} ${current?.label} (${current?.description}) ${current?.links} wikis\n  AI : ${verdict ?? (kept ? `${kept.qid} ${kept.label} (${kept.description})` : 'none')}`);
    if (titles) console.log(`  titles: ${titles.join(' | ').slice(0, 300)}`);
}
await prisma.$disconnect();
