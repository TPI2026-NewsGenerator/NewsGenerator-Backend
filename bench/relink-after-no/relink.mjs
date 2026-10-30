// The names the check of a card sends away ("no": the item of the name is another thing than the card means, see
// services/utils/name-check.js) are left with no link, so no country. Here: what a new search for the name would
// find and the AI choose on that card, for the 14 wrong stored links of bench/card-check (truth.json, W) and the
// 2 of the right country only (C). The name is searched again in Wikidata (the items called exactly so, the
// refused one left out), described, and the AI chooses among them with what the card says (linkPrompt).
// Writes cases.json to be judged by hand into truth.json.
// node --env-file=.env bench/relink-after-no/relink.mjs
import fs from 'node:fs';
import {exactItems, describeItems} from '../../services/utils/wikidata.js';
import {countryName, linkPrompt} from '../../services/utils/name-check.js';
import {ollamaJson} from '../../services/utils/ollama.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {prisma} from '../../config/db.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const cards = read('../card-check/cards.json');
const truth = read('../card-check/truth.json');
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 12) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 10000) + 1000));
        }
    }
};
// the same cases once, a card per name and story
const cases = cards.map((card, i) => ({card, truth: truth[i]})).filter(({truth: t}) => t === 'W' || t === 'C');
const out = [];
for (const {card, truth: t} of cases) {
    // what the link loop does for a name: a person in full or an organisation (name-check.js withNamesLinked)
    const eligible = card.kind === 'organization' || (card.kind === 'person' && mentionKey(card.name).includes(' '));
    const [row] = await prisma.$queryRawUnsafe(`SELECT id, lang FROM mentions WHERE key LIKE $1 AND kind = $2 ORDER BY seen DESC LIMIT 1`, mentionKey(card.name).replace(/�/g, '_'), card.kind);
    const entry = {name: card.name, kind: card.kind, truth: t, refused: `${card.label} (${card.description})`, titles: card.titles.slice(0, 3), sites: card.sites, eligible, lang: row?.lang ?? null};
    if (eligible && row) {
        const qids = (await patient(() => exactItems(card.name, row.lang ?? 'en'))).filter(qid => qid !== card.qid).slice(0, 10);
        const described = qids.length ? await patient(() => describeItems(qids, {batch: 10})) : [];
        entry.candidates = described.map(item => `${item.label}: ${item.description || '(no description)'} (${item.links} Wikipedias)`);
        if (described.length > 0) {
            const answer = await ollamaJson(linkPrompt({name: card.name, kind: card.kind, titles: card.titles.slice(0, 6), countries: Object.entries(card.sites ?? {}).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${countryName(code)} (${n})`).join(', '),
                topic: card.topic, others: card.others.filter(other => other !== card.name), candidates: described}), {});
            const chosen = described[Number(answer?.n) - 1];
            entry.chosen = chosen ? `${chosen.label}: ${chosen.description} (${chosen.links} Wikipedias)` : null;
        }
    }
    out.push(entry);
    console.log(`${entry.name} -> ${eligible ? (entry.candidates?.length ?? 0) + ' candidates' : 'not eligible'} ; chosen: ${entry.chosen ?? 'none'}`);
}
fs.writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(out, null, 1));
await prisma.$disconnect();
process.exit(0);
