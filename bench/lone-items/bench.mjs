//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: bench.mjs
//  Description: Measure of the rule linking a person to the one item of Wikidata called so, whatever it
//               is ("Eduardo Varela", a Uruguayan referee, became a Mexican journalist in 0 Wikipedias,
//               17.10.2026). Takes the persons of a full name linked to an item in 0 to 9 Wikipedias (read
//               by items.mjs: famousHuman never links one, so the one item rule did), the most met first
//               and as many at random, with 3 titles of their news, the sites naming them, the country of
//               their media (country-names.js mediaOf) and of the item; writes results.json and review.txt
//               for a judgement by hand (truth.json). Read-only on the database
//               node --env-file=.env bench/lone-items/bench.mjs [count of each | --names=A,B]
//               (--names: these names only, into results-named.json and review-named.txt; --zero: count at
//               random of the items in 0 Wikipedias only, into results-zero.json and review-zero.txt)
//

import fs from 'node:fs';
import pg from 'pg';
import {readCountries} from '../../services/utils/wikidata.js';
import {mediaOf} from '../../services/utils/country-names.js';

const NAMES = process.argv[2]?.startsWith('--names=') ? process.argv[2].slice('--names='.length).split(',') : null;
const COUNT = NAMES ? 0 : Number(process.argv[2] ?? 60);
const ZERO = process.argv[3] === '--zero';
const SUFFIX = NAMES ? '-named' : ZERO ? '-zero' : '';
const MAX_LINKS = ZERO ? 0 : 9;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url)));
const low = Object.values(items).filter(item => !item.missing && item.links <= MAX_LINKS).map(item => item.qid);

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
// the most met, then as many of the others at random
const {rows} = await db.query(`
    WITH named AS (
        SELECT id, name, lang, seen, qid FROM mentions
        WHERE kind = 'person' AND key LIKE '% %' AND qid = ANY($1::text[]) AND ($3::text[] IS NULL OR name = ANY($3::text[]))
    ), most AS (SELECT * FROM named ORDER BY seen DESC LIMIT $4)
    SELECT *, true AS most FROM most
    UNION ALL (SELECT *, false FROM named WHERE id NOT IN (SELECT id FROM most) AND $3::text[] IS NULL ORDER BY random() LIMIT $2)
    UNION ALL (SELECT *, false FROM named WHERE $3::text[] IS NOT NULL)`, [low, COUNT, NAMES, ZERO ? 0 : COUNT]);
const ids = rows.map(row => row.id);
const titles = await db.query(`
    SELECT id_mention AS id, (array_agg(title ORDER BY aid DESC))[1:3] AS titles FROM (
        SELECT DISTINCT ON (am.id_mention, a.title) am.id_mention, a.title, a.id AS aid
        FROM article_mentions am JOIN articles a ON a.id = am.id_article
        WHERE am.id_mention = ANY($1::int[]) AND a.title IS NOT NULL ORDER BY am.id_mention, a.title, a.id DESC
    ) t GROUP BY id_mention`, [ids]);
// as MentionModel.sitesNaming
const sites = await db.query(`
    SELECT am.id_mention AS id, regexp_replace(lower(split_part(a.link, '/', 3)), '^www\.', '') AS site, count(*)::int AS news
    FROM article_mentions am JOIN articles a ON a.id = am.id_article
    WHERE am.id_mention = ANY($1::int[]) GROUP BY 1, 2`, [ids]);
const known = await db.query(`SELECT qid, country FROM item_countries WHERE qid = ANY($1::text[])`, [rows.map(row => row.qid)]);
await db.end();

const titlesOf = new Map(titles.rows.map(row => [row.id, row.titles]));
const sitesOf = new Map();
for (const row of sites.rows) sitesOf.set(row.id, [...(sitesOf.get(row.id) ?? []), {site: row.site, news: row.news}]);
const countryOf = new Map(known.rows.map(row => [row.qid, row.country]));
// the countries never read, read as the cards read them, waiting when Wikidata asks to
const unread = [...new Set(rows.map(row => row.qid).filter(qid => !countryOf.has(qid)))];
for (let i = 0; i < unread.length; i += 40) {
    for (;;) {
        try {
            const read = await readCountries(unread.slice(i, i + 40));
            read.forEach((value, qid) => countryOf.set(qid, value.country));
            break;
        } catch (err) {
            if (!err.paused) throw err;
            await wait((err.retryIn ?? 30e3) + 1000);
        }
    }
    await wait(5000);
}

const results = rows.map(row => {
    const naming = (sitesOf.get(row.id) ?? []).sort((a, b) => b.news - a.news);
    const media = mediaOf(naming);
    const item = items[row.qid];
    return {
        id: row.id, name: row.name, lang: row.lang, seen: row.seen, most: row.most, qid: row.qid,
        description: item.description, links: item.links, human: item.human, country: countryOf.get(row.qid) ?? null,
        mediaCountry: media.country, byline: media.byline, sites: naming.slice(0, 4).map(s => `${s.site} ${s.news}`),
        titles: titlesOf.get(row.id) ?? [],
    };
});
fs.writeFileSync(new URL(`./results${SUFFIX}.json`, import.meta.url), JSON.stringify(results, null, 1));
fs.writeFileSync(new URL(`./review${SUFFIX}.txt`, import.meta.url), results.map((e, i) => [
    `# ${i + 1} ${e.name} (${e.lang}, ${e.seen}${e.most ? ', most met' : ''}) media ${e.mediaCountry ?? '-'}${e.byline ? ' BYLINE' : ''}: ${e.sites.join(', ')}`,
    `  I: ${e.qid} ${e.links} wikis ${e.country ?? '-'} ${e.human ? '' : 'NOT HUMAN '}${e.description ?? '(no description)'}`,
    ...e.titles.map(title => `  T: ${title.slice(0, 140)}`),
].join('\n')).join('\n\n'));
console.log(`${low.length} items in 0-${MAX_LINKS} Wikipedias; ${results.length} persons written`);
