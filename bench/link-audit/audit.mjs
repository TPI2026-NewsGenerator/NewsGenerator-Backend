// An audit of the links of the names most seen, by class of error found by what Wikidata says of the item
// against the name and its news (read only): TYPE (a person no human; a body, a place a human, a work),
// ALIAS (the item is called nothing like the name: "Primera División" the Maltese First Division),
// MEDIA (the item's country is no country of the media naming it), LOW (one Wikipedia or none, met 100
// times), GENERIC (a common noun), and the names most seen left with no link. Writes audit.json and prints
// the classes with their first cases. node --env-file=.env bench/link-audit/audit.mjs [per kind, 300]
import fs from 'node:fs';
import pg from 'pg';
import {describeItems, readCountries} from '../../services/utils/wikidata.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {mediaOf} from '../../services/utils/country-names.js';
import {MentionModel} from '../../models/mention-model.js';
import {prisma} from '../../config/db.js';

const PER_KIND = Number(process.argv[2] ?? 300);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// asked again after a refusal, as the link loop does
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 8) throw err;
            await wait((err.retryIn ?? 30000) + 1000);
        }
    }
};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const linked = [];
for (const kind of ['person', 'organization', 'location']) {
    linked.push(...(await db.query(`SELECT id, kind, name, key, lang, qid, seen FROM mentions WHERE kind = $1 AND qid IS NOT NULL
        ORDER BY seen DESC LIMIT $2`, [kind, PER_KIND])).rows);
}
const missing = (await db.query(`SELECT id, kind, name, lang, seen FROM mentions WHERE qid IS NULL AND linked_at IS NOT NULL
    AND kind <> 'location' ORDER BY seen DESC LIMIT 60`)).rows;
await db.end();

const qids = [...new Set(linked.map(row => row.qid))];
const items = new Map();
for (let i = 0; i < qids.length; i += 10) {
    for (const item of await patient(() => describeItems(qids.slice(i, i + 10)))) items.set(item.qid, item);
    await wait(300);
}
const countries = new Map();
for (let i = 0; i < qids.length; i += 40) {
    for (const [qid, country] of await patient(() => readCountries(qids.slice(i, i + 40)))) countries.set(qid, country);
    await wait(300);
}

const words = (text) => mentionKey(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1);
const classes = {TYPE: [], ALIAS: [], MEDIA: [], LOW: [], GENERIC: []};
for (const row of linked) {
    const item = items.get(row.qid);
    if (!item) continue;
    const shown = {kind: row.kind, name: row.name, lang: row.lang, seen: row.seen, qid: row.qid, label: item.label, description: item.description, links: item.links};
    const type = row.kind === 'person' ? !item.human : row.kind === 'organization' ? item.human || item.work || item.place : item.human || item.work;
    if (type) classes.TYPE.push({...shown, human: item.human, place: item.place, work: item.work});
    const name = new Set(words(row.name));
    const label = new Set(words(item.label));
    if (!type && ![...name].some(word => label.has(word))) classes.ALIAS.push(shown);
    const country = countries.get(row.qid);
    if (country?.country && !country.international && row.kind !== 'person') {
        const media = mediaOf(await MentionModel.sitesNaming(row.id));
        if (media.country && media.country !== country.country) classes.MEDIA.push({...shown, itemCountry: country.country, mediaCountry: media.country});
    }
    if (item.links <= 1 && row.seen >= 100) classes.LOW.push(shown);
    if (/^\p{Ll}+$/u.test(row.name)) classes.GENERIC.push(shown);
}
fs.writeFileSync(new URL('./audit.json', import.meta.url), JSON.stringify({checked: linked.length, classes, missing}, null, 1));
console.log(`${linked.length} links checked (${PER_KIND} most seen per kind)`);
for (const [name, list] of Object.entries(classes)) {
    console.log(`\n== ${name}: ${list.length}`);
    for (const row of list.slice(0, 30)) console.log(`${row.seen}\t${row.kind[0]}\t${row.name} [${row.lang}] -> ${row.label} (${row.description}) ${row.links} wikis${row.itemCountry ? ` item ${row.itemCountry} media ${row.mediaCountry}` : ''}`);
}
console.log(`\n== missing: the most seen names left with no link`);
for (const row of missing.slice(0, 60)) console.log(`${row.seen}\t${row.kind[0]}\t${row.name} [${row.lang}]`);
await prisma.$disconnect();
