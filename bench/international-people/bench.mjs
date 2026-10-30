//
//  Author: Fabian Rostello
//  Date: 19.10.2026
//  File: bench.mjs
//  Description: Measure of which people of a card naming an international body (UEFA, FIFA) lose their
//               country: today every one does, and "Românul Feșnic ... pe paginile UEFA" (a Romanian
//               referee) showed Italy only, from Milan. Reads the cards of the briefings of the last days
//               naming such a body, the claims of their people and bodies in Wikidata, and writes the
//               countries each rule gives in results.json, for a judgement by hand (truth.json, score.mjs).
//               Read only: the database is only read, the countries read from Wikidata are not kept
//               node bench/international-people/bench.mjs [days]
//

import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {MentionModel} from '../../models/mention-model.js';
import {cardNames, withSurnamesLinked} from '../../services/utils/card-names.js';
import {countryNamed} from '../../services/utils/country-names.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {cardCountries, countriesOfItems, MAX_COUNTRIES} from '../../services/utils/countries.js';
import {readCountries} from '../../services/utils/wikidata.js';
import {mediumOfArticle} from '../../services/utils/reading-order.js';

const DAYS = Number(process.argv[2] ?? 14);
const OUT = new URL('./results.json', import.meta.url);
const PAUSE_MS = 1500;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// read only: the countries of the items read now are not written in item_countries
MentionModel.saveCountries = async () => 0;

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
// the countries as production read them before 19.10.2026 (item_countries without its bodies)
MentionModel.countriesOf = async (qids) => (await db.query(`SELECT qid, country, international, '{}'::text[] AS bodies
    FROM item_countries WHERE qid = ANY($1::text[])`, [qids])).rows;

// the cards shown in the briefings of the last days, each story once (its last showing)
const {rows: shown} = await db.query(`
    SELECT DISTINCT ON (x->>'storyId') (x->>'storyId')::int AS "storyId", x->>'title' AS title, x->'articles' AS articles,
           x->'mergedStoryIds' AS merged, x->'countries' AS shown, b.id AS briefing
    FROM briefings b, jsonb_array_elements(b.items) x
    WHERE b.status = 'ready' AND b.created_at > now() - make_interval(days => $1)
    ORDER BY x->>'storyId', b.created_at DESC`, [DAYS]);
console.log(`${shown.length} cards in ${DAYS} days`);

// the news of a card: the ones of its stories it lists, else all of them
const cards = [];
for (const card of shown) {
    const stories = [card.storyId, ...(card.merged ?? [])];
    const links = (card.articles ?? []).map(article => article.url);
    let {rows} = await db.query(`SELECT id, link, medium FROM articles WHERE id_story = ANY($1::int[]) AND link = ANY($2::text[])`, [stories, links]);
    if (rows.length === 0) ({rows} = await db.query(`SELECT id, link, medium FROM articles WHERE id_story = ANY($1::int[])`, [stories]));
    if (rows.length === 0) continue;
    cards.push({...card, ids: rows.map(row => row.id), media: [...new Set(rows.map(mediumOfArticle))]});
}

// as card-names.js readNames + namesAndCountriesOfCards, without asking Wikidata for names first
const SHARE_OF_CARD = 0.25;
const SURNAME_COUNTRY_SEEN = 100;
const read = [];
for (const card of cards) {
    const rows = await MentionModel.namesOfArticles(card.ids, 3);
    const least = Math.max(1, Math.ceil(card.ids.length * SHARE_OF_CARD));
    const places = rows.filter(row => row.kind === 'location' && row.inCard >= least && !countryNamed(row.name) && row.qid);
    // the news of the card naming a name: the most of its writings (card-names.js chosenNames inCard)
    const inCard = (name) => Math.max(1, ...rows.filter(row => (name.qid && row.qid === name.qid) || row.name === name.name
        || (!row.qid && mentionKey(name.name).endsWith(mentionKey(row.name)))).map(row => row.inCard));
    read.push({card, names: cardNames(rows, card.ids.length, {media: card.media}).map(name => ({...name, inCard: inCard(name)})), places,
        countries: rows.filter(row => row.kind !== 'person' && row.inCard >= least)
            .map(row => ({code: countryNamed(row.name), inCard: row.inCard})).filter(row => row.code)});
}
// card-names.js surnameKey: one word of four letters at least, its article left out
const surnameKey = (name) => {
    const key = mentionKey(name.name).replace(/^(un|une|les|le|la|l|the|a|an|el|los|las|il|lo) (?=\S+$)/, '');
    return !name.qid && !key.includes(' ') && key.length >= 4 && ['person', 'organization'].includes(name.kind) ? key : null;
};
const persons = await MentionModel.personsEndingWith([...new Set(read.flatMap(card => card.names.map(surnameKey).filter(Boolean)))]);
const linked = withSurnamesLinked(read.map(card => card.names), persons);
read.forEach((card, i) => { card.names = linked[i]; });
const items = read.map(card => [...card.names, ...card.places]
    .filter(row => row.qid && !(row.bySurname < SURNAME_COUNTRY_SEEN) && !countryNamed(row.name))
    .map(row => ({qid: row.qid, name: row.name, weight: row.inCard, person: row.kind === 'person'})));
const countryOf = await countriesOfItems(items.flat().map(item => item.qid));
read.forEach((card, i) => card.countries.forEach(row => {
    items[i].push({qid: `country:${row.code}`, name: row.code, weight: row.inCard, person: false});
    countryOf.set(`country:${row.code}`, {country: row.code, international: false});
}));

const chosen = read.map((card, i) => ({card: card.card, items: items[i]}))
    .filter(({items}) => items.some(item => countryOf.get(item.qid)?.international));
console.log(`${chosen.length} cards name an international body`);

// the claims of items in Wikidata, with labels, a few at a time
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; self-hosted news reader, bench)', Accept: 'application/json'};
const entities = new Map();
const readItems = async (qids) => {
    const missing = [...new Set(qids)].filter(qid => /^Q\d+$/.test(qid) && !entities.has(qid));
    for (let i = 0; i < missing.length;) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: missing.slice(i, i + 40).join('|'), props: 'claims|labels', languages: 'en|fr', format: 'json'});
        const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: HEADERS});
        if (res.status === 429) {
            await wait((Number(res.headers.get('retry-after')) || 30) * 1000 + 1000);
            continue;
        }
        for (const [qid, item] of Object.entries((await res.json()).entities ?? {})) entities.set(qid, item);
        i += 40;
        await wait(PAUSE_MS);
    }
};
const label = (qid) => entities.get(qid)?.labels?.en?.value ?? entities.get(qid)?.labels?.fr?.value ?? qid;
// [{value, ended}] of a property of an item, the deprecated ones left out
const values = (qid, property) => (entities.get(qid)?.claims?.[property] ?? []).filter(claim => claim.rank !== 'deprecated')
    .map(claim => ({value: claim.mainsnak?.datavalue?.value?.id, ended: Boolean(claim.qualifiers?.P582),
        of: [...(claim.qualifiers?.P642 ?? []), ...(claim.qualifiers?.P2389 ?? [])].map(q => q.datavalue?.value?.id).filter(Boolean)}))
    .filter(row => row.value);

// what a person is to a body, by the person: employer, member of, position held (the position of
// the body: of it P2389/P361/P1001, or the qualifier "of"); by the body: chair, director, chief
// executive, board member, officer, head's office
const PERSON_LINKS = ['P108', 'P463', 'P39', 'P54', 'P102'];
const BODY_LINKS = ['P488', 'P1037', 'P169', 'P3320', 'P2828', 'P5052', 'P112'];
const POSITION_OF = ['P2389', 'P361', 'P1001', 'P642'];

const personQids = chosen.flatMap(({items}) => items.filter(item => item.person).map(item => item.qid));
const bodyQids = chosen.flatMap(({items}) => items.filter(item => countryOf.get(item.qid)?.international).map(item => item.qid));
await readItems([...personQids, ...bodyQids]);
const positions = personQids.flatMap(qid => values(qid, 'P39').map(row => row.value));
await readItems(positions);
// the bodies the people are linked to: [{body, relation, ended}]
const linksOf = (person, {positions = true} = {}) => {
    const found = [];
    for (const property of PERSON_LINKS) {
        for (const row of values(person, property)) {
            const bodies = property === 'P39'
                ? [...row.of, ...(positions ? POSITION_OF.flatMap(p => values(row.value, p).map(r => r.value)) : [])]
                : [row.value];
            bodies.forEach(body => found.push({body, relation: property === 'P39' ? `P39 ${label(row.value)}` : property, ended: row.ended}));
        }
    }
    return found;
};
const allBodies = [...new Set(personQids.flatMap(person => linksOf(person).map(link => link.body)))];
const bodyCountries = await countriesOfItems(allBodies);
await readItems(allBodies.filter(qid => bodyCountries.get(qid)?.international));

// the bodies international only as part of one (P749, P361), with a country of their own (P17): the
// French Football Federation is UEFA's (P749) but French; the FIFA Council is in Switzerland as FIFA
const INTERNATIONAL = new Set(['Q484652', 'Q245065', 'Q1335818', 'Q1127126', 'Q4120211', 'Q11422536']);
const WIDE_AREAS = new Set(['Q13780930', 'Q46', 'Q15', 'Q48', 'Q49', 'Q18', 'Q538', 'Q828', 'Q51']);
const byParent = [...new Set(bodyQids)].filter(qid => !values(qid, 'P31').some(row => INTERNATIONAL.has(row.value))
    && !values(qid, 'P2541').some(row => WIDE_AREAS.has(row.value)));
const parentsOf = (qid) => [...values(qid, 'P749'), ...values(qid, 'P361')].map(row => row.value);
await readItems(byParent.flatMap(qid => [...parentsOf(qid), ...values(qid, 'P17').map(row => row.value)]));
const codeOf = (qid) => (entities.get(qid)?.claims?.P297 ?? []).map(claim => claim.mainsnak?.datavalue?.value).find(code => /^[A-Z]{2}$/.test(code ?? '')) ?? null;
// national: international by its parent organisation (P749) only, never as part (P361) of one
const national = new Map();
for (const qid of byParent) {
    const own = values(qid, 'P17').map(row => row.value)[0];
    if (own && values(qid, 'P361').length === 0 && codeOf(own)) national.set(qid, codeOf(own));
}
console.log('national bodies taken for international:', [...national].map(([qid, code]) => `${label(qid)} ${code}`).join(', '));
const countryFed = new Map(countryOf);
national.forEach((code, qid) => countryFed.set(qid, {country: code, international: false}));

const RULES = {
    // today: every person of a card naming one loses their country
    all: () => true,
    // none does
    none: () => false,
    // a person linked to a body of the card, by them or by it, ended or not
    onCard: (person, bodies) => bodies.some(body => linksOf(person).some(link => link.body === body)
        || BODY_LINKS.some(p => values(body, p).some(row => row.value === person))),
    // the same, links still true only
    onCardNow: (person, bodies) => bodies.some(body => linksOf(person).some(link => link.body === body && !link.ended)
        || BODY_LINKS.some(p => values(body, p).some(row => row.value === person && !row.ended))),
    // a person linked to a body of the card by them only (no claim of the body read)
    byPerson: (person, bodies) => bodies.some(body => linksOf(person).some(link => link.body === body)),
    // the same, a position's body read from its qualifiers only (no claim of the position read)
    byPersonQualifiers: (person, bodies) => bodies.some(body => linksOf(person, {positions: false}).some(link => link.body === body)),
    // a person linked to any international body (Infantino on a card naming UEFA only)
    anyBody: (person, bodies) => RULES.onCard(person, bodies) || linksOf(person).some(link => bodyCountries.get(link.body)?.international),
    anyBodyNow: (person, bodies) => RULES.onCardNow(person, bodies)
        || linksOf(person).some(link => !link.ended && bodyCountries.get(link.body)?.international),
};

// countries.js cardCountries with a rule telling which people lose their country
const countriesBy = (items, dropped, countryOf) => {
    const weights = new Map();
    for (const {qid, weight, person} of items) weights.set(qid, {weight: Math.max(weights.get(qid)?.weight ?? 0, weight), person});
    const scores = new Map();
    for (const [qid, {weight, person}] of weights) {
        const code = countryOf.get(qid)?.country;
        if (code && !(person && dropped(qid))) scores.set(code, (scores.get(code) ?? 0) + weight);
    }
    const ranked = [...scores].sort((a, b) => b[1] - a[1]);
    return ranked.filter(([, score]) => score >= ranked[0][1] * 0.5).slice(0, MAX_COUNTRIES).map(([code]) => code);
};

// the rule built (countries.js, wikidata.js readCountries), on the items read again from Wikidata now
const built = await readCountries(chosen.flatMap(({items}) => items.map(item => item.qid)).filter(qid => qid.startsWith('Q')));
chosen.forEach(({items}) => items.filter(item => item.qid.startsWith('country:'))
    .forEach(item => built.set(item.qid, {country: item.name, international: false})));

const results = chosen.map(({card, items}) => {
    const bodies = items.filter(item => countryOf.get(item.qid)?.international).map(item => item.qid);
    const bodiesFed = bodies.filter(qid => !national.has(qid));
    // a card naming no international body but a national one: nobody loses their country
    const rule = (drops, bodies) => (person) => bodies.length > 0 && drops(person, bodies);
    return {
        storyId: card.storyId, title: card.title, media: card.media, articles: card.ids.length, shown: card.shown ?? null,
        items: items.map(item => ({qid: item.qid, name: item.name, label: label(item.qid), weight: item.weight, person: item.person,
            country: countryOf.get(item.qid)?.country ?? null, international: Boolean(countryOf.get(item.qid)?.international),
            links: item.person ? linksOf(item.qid).filter(link => bodies.includes(link.body) || bodyCountries.get(link.body)?.international)
                .map(link => `${link.relation} ${label(link.body)}${link.ended ? ' (ended)' : ''}`) : undefined})),
        rules: Object.fromEntries([...Object.entries(RULES).map(([name, drops]) => [name, countriesBy(items, rule(drops, bodies), countryOf)]),
            ...Object.entries(RULES).map(([name, drops]) => [`fed.${name}`, countriesBy(items, rule(drops, bodiesFed), countryFed)]),
            ['built', cardCountries(items, built)]]),
    };
});
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(`${results.length} cards written, ${results.filter(r => new Set(Object.values(r.rules).map(c => c.join())).size > 1).length} where the rules differ`);
await db.end();
process.exit(0);
