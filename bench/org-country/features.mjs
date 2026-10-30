// For the organisations linked to the one item called so and judged by hand (lone-organizations truth, plus
// three found by bench/link-audit: "Primera División" the Maltese league, "OL" Open Library, "Assemblée
// nationale" Senegal's), what Wikidata says of the item's country and which countries the sites naming the
// name are of. Writes features.json (read only). node --env-file=.env bench/org-country/features.mjs
import fs from 'node:fs';
import pg from 'pg';
import {readCountries} from '../../services/utils/wikidata.js';
import {countryOfSite} from '../../services/utils/country-names.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const truth = read('../lone-organizations/truth.json');
const judged = read('../lone-organizations/results.json').filter(e => e.lone && [true, false, 'country'].includes(truth[e.name]?.[e.qid]))
    .map(e => ({id: e.id, name: e.name, lang: e.lang, seen: e.seen, qid: e.qid, links: e.links, label: e.label, description: e.description, verdict: truth[e.name][e.qid]}));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
// judged by hand 21.10.2026 on their titles: the Maltese league for a Spanish name, Open Library for the OL
// of Lyon, the Assemblée nationale of Senegal for the French one
const extra = [['primera division', 'es', 'Q58305', false], ['ol', 'fr', null, false], ['assemblee nationale', 'fr', null, false]];
for (const [key, lang, qid, verdict] of extra) {
    const {rows: [row]} = await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE kind = 'organization' AND key = $1 AND lang = $2 AND qid IS NOT NULL ORDER BY seen DESC LIMIT 1`, [key, lang]);
    if (row) judged.push({id: row.id, name: row.name, lang, seen: row.seen, qid: row.qid, verdict, extra: true});
}
const countries = await readCountries([...new Set(judged.map(e => e.qid))]);
for (const e of judged) {
    const {rows} = await db.query(`SELECT regexp_replace(lower(split_part(a.link, '/', 3)), '^www\.', '') AS site, count(*)::int AS news
        FROM article_mentions am JOIN articles a ON a.id = am.id_article WHERE am.id_mention = $1 GROUP BY 1`, [e.id]);
    const byCountry = {};
    let total = 0;
    for (const row of rows) {
        total += row.news;
        const code = countryOfSite(row.site);
        if (code) byCountry[code] = (byCountry[code] ?? 0) + row.news;
    }
    e.total = total;
    e.byCountry = byCountry;
    e.itemCountry = countries.get(e.qid)?.country ?? null;
    e.international = countries.get(e.qid)?.international ?? false;
}
await db.end();
fs.writeFileSync(new URL('./features.json', import.meta.url), JSON.stringify(judged, null, 1));
console.log(`${judged.length} judged (${judged.filter(e => e.verdict === true).length} right, ${judged.filter(e => e.verdict === false).length} wrong, ${judged.filter(e => e.verdict === 'country').length} country)`);
for (const e of judged.filter(e => e.verdict !== true || e.extra)) console.log(`${e.verdict}\t${e.name} [${e.lang}] ${e.qid} ${e.label ?? ''} item ${e.itemCountry} links ${e.links} sites ${JSON.stringify(e.byCountry)}`);
