// The bench of the names to tell apart by their context: each case a name with the items Wikidata finds for
// it, the titles of the news naming it and the countries of the sites naming it, and the items judged by hand
// (right: the one the news name; country: a wrong one of the right country; wrong). Two sources:
// - the 123 organisations judged for bench/lone-organizations (their candidates and titles were kept),
// - EXTRAS: names found wrong or fixed during the audit of 21.10.2026 (OL, Primera División, UAE, EU, "FMF" of a
//   Malagasy card, Farc, DocMorris...), their items searched now, judged on their titles.
// Writes cases.json. node --env-file=.env bench/context/cases.mjs
import fs from 'node:fs';
import pg from 'pg';
import {describeItems, namedItems} from '../../services/utils/wikidata.js';
import {mentionKey} from '../../services/utils/mentions.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 20) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
};
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const sitesOf = async (id) => {
    const {rows} = await db.query(`SELECT regexp_replace(lower(split_part(a.link, '/', 3)), '^www\.', '') AS site, count(*)::int AS news
        FROM article_mentions am JOIN articles a ON a.id = am.id_article WHERE am.id_mention = $1 GROUP BY 1`, [id]);
    return rows;
};
const titlesOf = async (id) => (await db.query(`SELECT title FROM (SELECT DISTINCT ON (a.title) a.title, a.id FROM article_mentions am JOIN articles a ON a.id = am.id_article
    WHERE am.id_mention = $1 AND a.title IS NOT NULL ORDER BY a.title, a.id DESC LIMIT 200) t ORDER BY id DESC LIMIT 5`, [id])).rows.map(row => row.title);
const items = new Map();
const describe = async (qids) => {
    const missing = [...new Set(qids)].filter(qid => !items.has(qid));
    for (let i = 0; i < missing.length; i += 10) {
        for (const item of await patient(() => describeItems(missing.slice(i, i + 10)))) items.set(item.qid, item);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
};

const cases = [];
// 1. the judged organisations
const truth = read('../lone-organizations/truth.json');
for (const result of read('../lone-organizations/results.json').filter(e => truth[e.name])) {
    const judged = truth[result.name];
    const found = (result.candidates ?? []).map(text => text.match(/^(Q\d+) (.*) \((\d+)\): (.*)$/)).filter(Boolean)
        .map(([, qid, label, links, description]) => ({qid, label, links: Number(links), description}));
    for (const qid of Object.keys(judged)) if (!found.some(c => c.qid === qid)) found.push({qid});
    const verdicts = Object.entries(judged).filter(([, v]) => [true, false, 'country'].includes(v));
    if (verdicts.length === 0) continue;
    cases.push({suite: 'judged', id: result.id, name: result.name, lang: result.lang, kind: 'organization', seen: result.seen,
        candidates: found, titles: result.titles ?? [], sites: await sitesOf(result.id),
        right: verdicts.filter(([, v]) => v === true).map(([q]) => q), country: verdicts.filter(([, v]) => v === 'country').map(([q]) => q),
        wrong: verdicts.filter(([, v]) => v === false).map(([q]) => q), baseline: result.ai?.qid ?? null, lone: result.lone, linked: result.qid});
}
// 2. the extras: [name, lang, right, wrong, country, titles of a card instead of the name's news]
const EXTRAS = [
    ['OL', 'fr', [], ['Q1201876']],
    ['Primera División', 'es', ['Q324867'], ['Q58305']],
    ['Assemblée nationale', 'fr', [], ['Q1853640']],
    ['UAE', 'en', ['Q878'], ['Q1420281']],
    ['EU', 'en', ['Q458'], ['Q211593']],
    ['Ghana Football', 'en', ['Q923074'], ['Q1478153']],
    ['Al-Hazm', 'es', ['Q2499905'], ['Q26201058']],
    ['Farc', 'es', ['Q155801'], ['Q38366566']],
    ['Μπεσίκτας', 'el', ['Q4086096', 'Q172567'], [], ['Q854669']],
    ['DocMorris', 'de', ['Q230343'], ['Q669499']],
    ['NIT', 'en', [], ['Q571381']],
    ['ברצלונה', null, ['Q7156'], []],
    ['Magenta TV', 'de', ['Q2401696'], []],
    ['FMF', 'ro', ['Q738074'], []],
    // the card of the Malagasy federation: the same name, the news of another country
    ['FMF', 'fr', ['Q662763'], ['Q738074'], [], 'MG'],
];
const cardTitles = ['FOOTBALL – Des représentants de clubs et d’autres acteurs intègrent le collège électoral pour élire les futurs dirigeants de la Fédération Malagasy de Football',
    'FMF : le collège électoral élargi aux clubs, aux arbitres et aux joueurs', 'Élections FMF : le comité de normalisation fixe la composition du collège électoral'];
for (const [name, lang, right, wrong, country = [], card] of EXTRAS) {
    const key = mentionKey(name);
    const {rows: [mention]} = await db.query(`SELECT id, lang, seen FROM mentions WHERE kind = 'organization' AND key = $1 ${card ? '' : 'AND lang IS NOT DISTINCT FROM $2'} ORDER BY seen DESC LIMIT 1`, card ? [key] : [key, lang]);
    if (!mention) { console.log(`no mention for ${name} [${lang}]`); continue; }
    const named = await patient(() => namedItems(name, lang ?? 'en'));
    const qids = [...new Set([...named.map(item => item.qid), ...right, ...wrong, ...country])];
    await describe(qids);
    cases.push({suite: 'extras', id: mention.id, name, lang, kind: 'organization', seen: mention.seen,
        candidates: qids.map(qid => items.get(qid) ?? {qid}), titles: card ? cardTitles : await titlesOf(mention.id),
        sites: card ? [{site: 'fmf.mg', news: 3}, {site: 'newsmada.com', news: 2}] : await sitesOf(mention.id), right, country, wrong, baseline: null, card: Boolean(card)});
}
await db.end();
for (const c of cases) {
    await describe(c.candidates.map(item => item.qid));
    c.candidates = c.candidates.map(item => ({qid: item.qid, label: items.get(item.qid)?.label ?? item.label, description: items.get(item.qid)?.description ?? item.description ?? '', links: items.get(item.qid)?.links ?? item.links ?? 0}));
}
fs.writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(cases, null, 1));
console.log(`${cases.length} cases (${cases.filter(c => c.suite === 'judged').length} judged, ${cases.filter(c => c.suite === 'extras').length} extras), ${cases.filter(c => c.candidates.length > 1).length} with several candidates`);
