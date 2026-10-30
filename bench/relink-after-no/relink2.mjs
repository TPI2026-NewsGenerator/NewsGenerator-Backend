// Where the candidates for a name sent away by the check of its card may come from, since the exact search of the
// name in Wikidata finds nothing for them (relink.mjs: 0 right of 16; for "FMF" 9 candidates, the Malagasy federation
// not among them):
//   A  what the text of the card says the name stands for: "Fédération malgache de football (FMF)" -> that name searched
//   B  the Wikipedia search of the name with the country of the sites of the card: "FMF Madagascar"
// then the AI chooses among them as for any name (linkPrompt). Writes cases2.json, judged by hand.
// node --env-file=.env bench/relink-after-no/relink2.mjs
import fs from 'node:fs';
import {exactItems, describeItems, wikimediaHeaders} from '../../services/utils/wikidata.js';
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

// the words a name is spelled with its initials without
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'y', 'e', 'da', 'do', 'di', 'del', 'della', 'and', 'et', 'und', 'van', 'von', 'el', 'al', 'd', 'l', 'a', 'o', 'dos', 'das']);
const initials = (words) => words.filter(word => !SMALL.has(word.toLowerCase().replace(/['’]$/, ''))).map(word => word[0]).join('').toLowerCase();
// "Fédération malgache de football (FMF)": the words before the parenthesis whose initials spell the name
const expansionOf = (name, text) => {
    const key = mentionKey(name).replace(/[^a-z]/g, '');
    if (key.length < 2 || key.length > 8) return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(new RegExp(`\\(\\s*${escaped}\\s*\\)`, 'g'))) {
        const words = text.slice(Math.max(0, match.index - 120), match.index).trim().split(/\s+/).map(word => word.replace(/^[«"“(]+/, '')).filter(Boolean);
        for (let size = 2; size <= 8 && size <= words.length; size++) {
            const tail = words.slice(-size);
            if (mentionKey(initials(tail)).replace(/[^a-z]/g, '') === key) return tail.join(' ');
        }
    }
    return null;
};

const wikipediaSearch = async (text, host = 'en.wikipedia.org') => {
    const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({action: 'query', generator: 'search', gsrsearch: text, gsrnamespace: '0', gsrlimit: '5',
        prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', format: 'json', formatversion: '2'})}`, {headers: wikimediaHeaders(), signal: AbortSignal.timeout(20000)});
    if (!res.ok) return [];
    return ((await res.json()).query?.pages ?? []).sort((a, b) => a.index - b.index).filter(page => page.pageprops?.wikibase_item && page.pageprops.disambiguation === undefined).map(page => page.pageprops.wikibase_item);
};

// the 6 right links the check sends away too (verdicts-rich.json, truth R and "no"): what the new step does to them
const verdicts = read('../card-check/verdicts-rich.json');
const KEEP = process.env.INCLUDE_REFUSED === '1';
const cases = cards.map((card, i) => ({card, truth: truth[i] === 'R' && verdicts[i] === 'no' ? 'R-no' : truth[i]})).filter(({truth: t}) => t === 'W' || t === 'C' || t === 'R-no');
const out = [];
for (const {card, truth: t} of cases) {
    const eligible = card.kind === 'organization' || (card.kind === 'person' && mentionKey(card.name).includes(' '));
    if (!eligible) continue;
    // the text of the card as written, from the briefing it was shown in
    const [item] = await prisma.$queryRawUnsafe(`SELECT i FROM briefings b, jsonb_array_elements(b.items::jsonb) i WHERE b.id = $1 AND (i->>'storyId')::int = $2 LIMIT 1`, card.briefing, card.storyId);
    const text = [item?.i?.digest, item?.i?.summary, item?.i?.points].filter(Boolean).join('\n');
    const countries = Object.entries(card.sites ?? {}).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${countryName(code)} (${n})`);
    const entry = {name: card.name, kind: card.kind, truth: t, refused: `${card.label} (${card.description})`, titles: card.titles.slice(0, 2), countries, hasText: text.length};
    const A = [];
    const expansion = expansionOf(card.name, text);
    entry.expansion = expansion;
    if (expansion) A.push(...(await patient(() => exactItems(expansion, card.language ?? 'en'))));
    const B = [];
    const place = countries[0]?.replace(/ \(\d+\)$/, '');
    if (place) B.push(...(await wikipediaSearch(`${card.name} ${place}`)));
    const qids = [...new Set([...A, ...B])].filter(qid => KEEP || qid !== card.qid).slice(0, 10);
    const described = qids.length ? await patient(() => describeItems(qids, {batch: 10})) : [];
    entry.fromA = A.length;
    entry.fromB = B.length;
    entry.candidates = described.map(d => `${A.includes(d.qid) ? 'A' : 'B'} ${d.label}: ${d.description || '(no description)'} (${d.links} Wikipedias)`);
    if (described.length > 0) {
        const answer = await ollamaJson(linkPrompt({name: card.name, kind: card.kind, titles: card.titles.slice(0, 6), countries: countries.join(', '), topic: card.topic,
            others: card.others.filter(other => other !== card.name), candidates: described}), {});
        const chosen = described[Number(answer?.n) - 1];
        entry.chosen = chosen ? `${chosen.label}: ${chosen.description} (${chosen.links} Wikipedias)` : null;
    }
    out.push(entry);
    console.log(`${entry.name} | expansion: ${expansion ?? '-'} | A ${A.length} B ${B.length} | chosen: ${entry.chosen ?? 'none'}`);
}
fs.writeFileSync(new URL(KEEP ? './cases2-keep.json' : './cases2.json', import.meta.url), JSON.stringify(out, null, 1));
await prisma.$disconnect();
process.exit(0);
