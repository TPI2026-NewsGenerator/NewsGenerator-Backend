//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: wikidata.js
//  Description: The clubs, people and organisations as Wikidata knows them: found by their name, read
//               with their other names and their links (the players and the coach of a club, the
//               team of a player, the league of a club)
//

"use strict"

import {isQid, kindOf, namesOf} from './wikidata-names.js';
import process from 'node:process';
import {mentionKey} from './mentions.js';

export {isQid};

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
// Wikimedia asks every client to name itself with a way to reach whoever runs it (its User-Agent policy:
// a client without contact is refused sooner), and to accept compressed answers (its robot policy, both
// sent to the user 18.10.2026). WIKIDATA_CONTACT: an address or an e-mail, the public site by default
const HEADERS = () => ({
    'User-Agent': `NewsGenerator/1.0 (${process.env.WIKIDATA_CONTACT || 'https://news.fabianrostello.com'}; self-hosted news reader)`,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
});
// work done in background (background: true) asks the API to answer "maxlag" instead of working when
// its databases lag more than this many seconds behind (API:Etiquette, for what no one waits for): it
// waits as asked, as for a refusal. Not what a reader waits for: the lag was over 5 s for long (6.2 s,
// 18.10.2026)
const MAX_LAG_S = 5;
const TIMEOUT_MS = 15000;
const MAX_FOUND = 8;
const MAX_LINKS = 80;
// the names of an item are read in these languages, and in the one of the reader
const LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl'];

// Refused (429), Wikidata says how long to wait: nothing is asked meanwhile, by anyone of this process
// (the names linked in background, a page, the official sources). Without an account it lets about 10
// searches a minute through (13.10.2026)
const PAUSE_MS = 30e3;
let pausedUntil = 0;

// retryIn: the milliseconds left of the pause
const paused = () => Object.assign(new Error('Wikidata asked to wait.'), {status: 502, paused: true, retryIn: Math.max(0, pausedUntil - Date.now())});
const ask = async (url, {background = false} = {}) => {
    if (Date.now() < pausedUntil) throw paused();
    const asked = background && url.startsWith(API) ? `${url}&maxlag=${MAX_LAG_S}` : url;
    const res = await fetch(asked, {headers: HEADERS(), signal: AbortSignal.timeout(TIMEOUT_MS)});
    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
    if (res.status === 429) {
        pausedUntil = Date.now() + (retryAfter || PAUSE_MS);
        throw paused();
    }
    if (!res.ok) throw Object.assign(new Error(`Wikidata answered ${res.status}.`), {status: 502});
    const answer = await res.json();
    // only the background is told to wait: a reader's call goes on
    if (answer.error?.code === 'maxlag') {
        throw Object.assign(new Error('Wikidata lags behind.'), {status: 502, paused: true, retryIn: retryAfter || MAX_LAG_S * 1000});
    }
    return answer;
};

const languagesOf = (language) => [...new Set([language, ...LANGUAGES].filter(Boolean))];
const valuesOf = (field, language) => languagesOf(language).map(code => field?.[code]?.value).filter(Boolean);

// [{qid, label, description}]: the items whose name starts with q, the best first
export const searchItems = async (q, language = 'en') => {
    const query = String(q ?? '').trim().slice(0, 100);
    if (query.length < 2) return [];
    const params = new URLSearchParams({action: 'wbsearchentities', search: query, language, uselang: language,
        type: 'item', limit: String(MAX_FOUND), format: 'json'});
    const answer = await ask(`${API}?${params}`);
    return (answer.search ?? []).filter(item => isQid(item.id)).map(item => ({
        qid: item.id, label: item.label ?? item.id, description: item.description ?? null,
    }));
};

// pages of Wikidata that are no person, body nor place a news names
const NOT_NAMED = /^(Wikimedia |family name|surname|given name|male given name|female given name|unisex given name|scholarly article|scientific article)/i;
const EXACT_FOUND = 10;

// [qid]: the items called exactly this name (a label or an alias, whatever the case and accents) in
// this language, in the order of Wikidata. A language Wikidata does not know is searched in English
export const exactItems = async (name, language = 'en') => {
    const key = mentionKey(name);
    if (key.length < 2) return [];
    return [...new Set((await searchNamed(name, language))
        .filter(item => mentionKey(item.match?.text ?? item.label) === key)
        .map(item => item.id))];
};

// The items an organisation may be ("Juventus" is "Juventus FC", "Liverpool" "Liverpool F.C."): the ones
// Wikidata finds called so or whose name starts so, in its order, [{qid, exact}], exact when called so.
// The famous club comes first under a longer name, the city before it (18.10.2026)
export const namedItems = async (name, language = 'en') => {
    const key = mentionKey(name);
    if (key.length < 2) return [];
    const startsSo = (text) => {
        const other = mentionKey(text);
        return other === key || other.startsWith(`${key} `);
    };
    const found = new Map();
    for (const item of await searchNamed(name, language)) {
        if (found.has(item.id) || !(startsSo(item.match?.text ?? item.label) || startsSo(item.label ?? ''))) continue;
        found.set(item.id, {qid: item.id, exact: mentionKey(item.match?.text ?? item.label) === key || mentionKey(item.label ?? '') === key});
    }
    return [...found.values()];
};

// [{qid, label, description, links, human}] of these items, in English: links the Wikipedias it is in,
// human when it is one (P31 Q5); the ones Wikidata does not have left out
export const describeItems = async (qids) => {
    const asked = [...new Set(qids.filter(isQid))].slice(0, EXACT_FOUND);
    if (asked.length === 0) return [];
    const params = new URLSearchParams({action: 'wbgetentities', ids: asked.join('|'), props: 'labels|descriptions|claims|sitelinks',
        languages: 'en', format: 'json'});
    const entities = (await ask(`${API}?${params}`)).entities ?? {};
    return asked.map(qid => entities[qid]).filter(item => item && item.missing === undefined).map(item => ({
        qid: item.id,
        label: item.labels?.en?.value ?? item.id,
        description: item.descriptions?.en?.value ?? '',
        links: Object.keys(item.sitelinks ?? {}).length,
        human: (item.claims?.P31 ?? []).some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5'),
    }));
};

// the items Wikidata finds for a name, pages of Wikimedia, of a family or given name aside, in its order
const searchNamed = async (name, language) => {
    // searched in its language, described in English: NOT_NAMED reads English ("Čeferin", a news in
    // Slovenian, was linked to the family name, described "priimek", 13.10.2026)
    const search = async (code) => ask(`${API}?${new URLSearchParams({action: 'wbsearchentities', search: String(name).slice(0, 100),
        language: code, uselang: 'en', type: 'item', limit: String(EXACT_FOUND), format: 'json'})}`);
    let answer = await search(language || 'en');
    if (answer.error && !/busy|maxlag/.test(answer.error.code ?? '') && language !== 'en') answer = await search('en');
    // too busy ("cirrussearch-too-busy-error", 13.10.2026): as a refusal, nothing asked for a while
    if (/busy|maxlag/.test(answer.error?.code ?? '')) {
        pausedUntil = Date.now() + PAUSE_MS;
        throw Object.assign(new Error('Wikidata asked to wait.'), {status: 502, paused: true});
    }
    if (answer.error) throw Object.assign(new Error(`Wikidata refused the search (${answer.error.code}).`), {status: 502});
    return (answer.search ?? []).filter(item => isQid(item.id) && !NOT_NAMED.test(item.description ?? ''));
};

// A person named as several items are: the one of them who is a human (P31 Q5) and is in far more
// Wikipedias than any other (sitelinks), the famous one. A famous name has the most namesakes: "David
// Beckham" a Canadian candidate, "Donald Trump" songs. On 40 names often met and never linked (18.10.2026)
// the persons were all told right (Trump 334 against 6, Messi 226 against 0, Lula 150 against 13), and
// "Michael Oliver" (the referee among 9) left alone. In 30 Wikipedias at least: in 10, the byline
// "Mohammed Ibrahim" of a sports site became Mo Ibrahim, a businessman in 20 (18.10.2026). null when none
// stands out
export const MIN_SITELINKS = 30;
export const SITELINKS_AHEAD = 3;
export const famousHuman = async (qids) => {
    const asked = [...new Set(qids.filter(isQid))].slice(0, EXACT_FOUND);
    if (asked.length === 0) return null;
    const params = new URLSearchParams({action: 'wbgetentities', ids: asked.join('|'), props: 'claims|sitelinks', format: 'json'});
    const entities = (await ask(`${API}?${params}`)).entities ?? {};
    const humans = asked.map(qid => entities[qid])
        .filter(item => item && item.missing === undefined && (item.claims?.P31 ?? []).some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5'))
        .map(item => ({qid: item.id, links: Object.keys(item.sitelinks ?? {}).length}))
        .sort((a, b) => b.links - a.links);
    const [first, second] = humans;
    return first && first.links >= MIN_SITELINKS && first.links >= SITELINKS_AHEAD * (second?.links ?? 0) ? first.qid : null;
};

// The channels an item publishes on, as Wikidata gives them: its website and its accounts
const CHANNELS = {site: 'P856', x: 'P2002', instagram: 'P2003', facebook: 'P2013', youtube: 'P2397', tiktok: 'P7085',
    mastodon: 'P4033', bluesky: 'P12361', telegram: 'P3789'};
const ITEMS_PER_CALL = 40;

// [{qid, label, description, channels: {site: [...], bluesky: [...], ...}}] of these items, in English,
// the ones Wikidata does not have left out
export const readChannels = async (qids) => {
    const found = [];
    const asked = qids.filter(isQid);
    for (let i = 0; i < asked.length; i += ITEMS_PER_CALL) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: asked.slice(i, i + ITEMS_PER_CALL).join('|'),
            props: 'labels|descriptions|claims', languages: 'en', format: 'json'});
        for (const [qid, item] of Object.entries((await ask(`${API}?${params}`)).entities ?? {})) {
            if (item.missing !== undefined) continue;
            const channels = Object.fromEntries(Object.entries(CHANNELS)
                .map(([name, property]) => [name, (item.claims?.[property] ?? []).filter(claim => claim.rank !== 'deprecated')
                    .map(claim => claim.mainsnak?.datavalue?.value).filter(value => typeof value === 'string')])
                .filter(([, values]) => values.length > 0));
            found.push({qid, label: item.labels?.en?.value ?? qid, description: item.descriptions?.en?.value ?? null, channels});
        }
    }
    return found;
};

// Map qid -> the name of the file of its picture on Wikimedia Commons (P18, "image"): the preferred
// one, else the first; the items without one left out
export const readPictures = async (qids) => {
    const found = new Map();
    const asked = [...new Set(qids.filter(isQid))];
    for (let i = 0; i < asked.length; i += ITEMS_PER_CALL) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: asked.slice(i, i + ITEMS_PER_CALL).join('|'),
            props: 'claims', format: 'json'});
        for (const [qid, item] of Object.entries((await ask(`${API}?${params}`)).entities ?? {})) {
            const claims = (item.claims?.P18 ?? []).filter(claim => claim.rank !== 'deprecated');
            const file = (claims.find(claim => claim.rank === 'preferred') ?? claims[0])?.mainsnak?.datavalue?.value;
            if (typeof file === 'string' && file) found.set(qid, file);
        }
    }
    return found;
};

// the values of a property, the preferred ones when it has some ("Paris": France preferred, the Kingdom of
// France and the others of its past normal), never the deprecated ones
const bestValues = (claims, property) => {
    const kept = (claims?.[property] ?? []).filter(claim => claim.rank !== 'deprecated');
    const preferred = kept.filter(claim => claim.rank === 'preferred');
    return (preferred.length > 0 ? preferred : kept).map(claim => claim.mainsnak?.datavalue?.value)
        .map(value => value?.id ?? value).filter(value => typeof value === 'string');
};
// an international body: the country Wikidata gives it is the one of its seat (FIFA, UEFA and the IOC
// Switzerland, the UN the United States, NATO Belgium), not the one it is of. International organisation,
// intergovernmental organisation, supranational union, military alliance, regional organisation,
// international sport governing body
const INTERNATIONAL = new Set(['Q484652', 'Q245065', 'Q1335818', 'Q1127126', 'Q4120211', 'Q11422536']);
// operating areas (P2541) wider than a country: the world (Google, Microsoft), the continents, the Americas
const WIDE_AREAS = new Set(['Q13780930', 'Q46', 'Q15', 'Q48', 'Q49', 'Q18', 'Q538', 'Q828', 'Q51']);
const COUNTRY_CODE = /^[A-Z]{2}$/;

// The country an item is of: {code} for a country itself (P297, ISO 3166-1), {qid} for the rest, null
// for none; international for a body of several countries or of the world, without country. A person:
// the country it plays for (P1532: Messi is of Argentina, Spain and Italy, plays for Argentina), else its
// first citizenship (P27); anything else its country (P17: Paris, Real Madrid, the Premier League)
const countryOfClaims = (claims) => {
    const kinds = (claims?.P31 ?? []).filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value?.id);
    if (kinds.some(kind => INTERNATIONAL.has(kind)) || bestValues(claims, 'P2541').some(area => WIDE_AREAS.has(area))) {
        return {international: true};
    }
    const code = bestValues(claims, 'P297').find(value => COUNTRY_CODE.test(value));
    if (code) return {code};
    const qid = kinds.includes('Q5') ? bestValues(claims, 'P1532')[0] ?? bestValues(claims, 'P27')[0] : bestValues(claims, 'P17')[0];
    return qid ? {qid} : null;
};

// the claims of these items: Map qid -> claims, the ones Wikidata does not have left out
const claimsOf = async (qids, options = {}) => {
    const found = new Map();
    for (let i = 0; i < qids.length; i += ITEMS_PER_CALL) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: qids.slice(i, i + ITEMS_PER_CALL).join('|'),
            props: 'claims', format: 'json'});
        for (const [qid, item] of Object.entries((await ask(`${API}?${params}`, options)).entities ?? {})) {
            if (item.missing === undefined) found.set(qid, item.claims ?? {});
        }
    }
    return found;
};

// the code of each country met, kept for as long as the process lives: about 200 of them; and whether
// the bodies items are part of are international
const codes = new Map();
const international = new Map();

// Map qid -> {country, international} of each item: country the code ISO 3166-1 alpha-2 of its country
// ("ZM"), null when none; international for a body of several countries (see countryOfClaims). A country
// with no code of its own is part of one (England, Scotland: the United Kingdom): the code of that one.
// Every item is answered, Wikidata asked a few times a card at most. background: see MAX_LAG_S
export const readCountries = async (qids, {background = false} = {}) => {
    const asked = [...new Set(qids.filter(isQid))];
    const claims = await claimsOf(asked, {background});
    const of = new Map(asked.map(qid => [qid, claims.has(qid) ? countryOfClaims(claims.get(qid)) : null]));
    // a body part of an international one (P361, P749) is one too: the FIFA Council has the country of
    // FIFA's seat
    const parentsOf = (qid) => of.get(qid)?.qid && !(claims.get(qid)?.P31 ?? []).some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5')
        ? [...bestValues(claims.get(qid), 'P361'), ...bestValues(claims.get(qid), 'P749')] : [];
    const parents = [...new Set(asked.flatMap(parentsOf))].filter(qid => !international.has(qid));
    if (parents.length > 0) {
        const read = await claimsOf(parents, {background});
        parents.forEach(qid => international.set(qid, Boolean(read.has(qid) && countryOfClaims(read.get(qid))?.international)));
    }
    for (const qid of asked) if (parentsOf(qid).some(parent => international.get(parent))) of.set(qid, {international: true});
    // the countries named, then the countries they are part of
    for (let round = 0; round < 2; round++) {
        const unknown = [...new Set([...of.values()].filter(country => country?.qid && !codes.has(country.qid)).map(country => country.qid))];
        if (unknown.length === 0) break;
        const read = await claimsOf(unknown, {background});
        for (const qid of unknown) {
            const code = bestValues(read.get(qid), 'P297').find(value => COUNTRY_CODE.test(value));
            const part = round === 0 && !code ? bestValues(read.get(qid), 'P17')[0] : null;
            if (part && part !== qid) {
                for (const [item, country] of of) if (country?.qid === qid) of.set(item, {qid: part});
            } else codes.set(qid, code ?? null);
        }
    }
    return new Map([...of].map(([qid, country]) => [qid, {
        country: country?.code ?? (country?.qid ? codes.get(country.qid) ?? null : null),
        international: Boolean(country?.international),
    }]));
};

// what an item says of others and others of it, still true (no end date). [relation, property]
const OUTGOING = [
    ['coach', 'P286'], ['league', 'P118'], ['chair', 'P488'], ['owner', 'P127'], ['venue', 'P115'],
    ['team', 'P54'], ['director', 'P1037'], ['chief executive', 'P169'], ['parent', 'P749'],
    ['member of', 'P463'], ['party', 'P102'], ['employer', 'P108'], ['position', 'P39'], ['organiser', 'P664'],
];
// the players of a club or of a team, the ones who joined since this year: a member whose end was
// never written stays one forever in Wikidata
const PLAYERS_SINCE = new Date().getUTCFullYear() - 6;

const linksQuery = (qid, kind, language) => {
    const out = OUTGOING.map(([relation, property]) => `(wd:${property} "${relation}")`).join(' ');
    const players = kind === 'club' || kind === 'team' ? `
  UNION {
    ?item p:P54 ?st . ?st ps:P54 wd:${qid} .
    FILTER NOT EXISTS { ?st pq:P582 ?end }
    ?st pq:P580 ?start . FILTER(YEAR(?start) >= ${PLAYERS_SINCE})
    BIND("player" AS ?rel)
  }` : '';
    return `SELECT DISTINCT ?rel ?item ?itemLabel ?itemDescription WHERE {
  {
    VALUES (?prop ?rel) { ${out} }
    ?prop wikibase:claim ?claim ; wikibase:statementProperty ?value .
    wd:${qid} ?claim ?st . ?st ?value ?item .
    FILTER NOT EXISTS { ?st pq:P582 ?end }
    ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  }${players}
  FILTER(isIRI(?item))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${languagesOf(language).join(',')}". }
} LIMIT ${MAX_LINKS}`;
};

// the kind of an item met only as a link, told by how it is linked
const LINKED_KIND = {player: 'person', coach: 'person', chair: 'person', director: 'person', 'chief executive': 'person',
    team: 'club', league: 'competition', parent: 'organisation', 'member of': 'organisation', party: 'organisation',
    employer: 'organisation', organiser: 'organisation', owner: 'other', venue: 'other', position: 'other'};

// {qid, label, description, kind, names, links: [{qid, label, description, kind, relation}]}, links null
// when they could not be read; null when Wikidata has no such item
export const readItem = async (qid, language = 'en') => {
    if (!isQid(qid)) return null;
    const params = new URLSearchParams({action: 'wbgetentities', ids: qid, props: 'labels|aliases|descriptions|claims',
        languages: languagesOf(language).join('|'), format: 'json'});
    const item = (await ask(`${API}?${params}`)).entities?.[qid];
    if (!item || item.missing !== undefined) return null;

    const claims = item.claims ?? {};
    const targets = (property) => (claims[property] ?? []).map(claim => claim.mainsnak?.datavalue?.value?.id).filter(isQid);
    const texts = (property) => (claims[property] ?? []).map(claim => claim.mainsnak?.datavalue?.value?.text).filter(Boolean);
    const kind = kindOf(targets('P31'));
    const labels = valuesOf(item.labels, language);
    const aliases = languagesOf(language).flatMap(code => (item.aliases?.[code] ?? []).map(alias => alias.value));

    // a person is named by their family name alone in most titles ("Dembélé"); a club or a body by its
    // short name (P1813: "PSG", "OM")
    let extra = texts('P1813');
    if (kind === 'person' && targets('P734').length > 0) {
        const family = targets('P734').slice(0, 2);
        const answer = await ask(`${API}?${new URLSearchParams({action: 'wbgetentities', ids: family.join('|'), props: 'labels',
            languages: languagesOf(language).join('|'), format: 'json'})}`).catch(() => ({}));
        extra = [...extra, ...family.flatMap(id => valuesOf(answer.entities?.[id]?.labels, language).slice(0, 1))
            .filter(name => name.length >= 4)];
    }

    // not read (the links of the UEFA timed out, 13.10.2026): null, the ones known are kept
    const sparql = await ask(`${SPARQL}?${new URLSearchParams({format: 'json', query: linksQuery(qid, kind, language)})}`)
        .catch(err => {
            console.error(`Wikidata: the links of ${qid} were not read (${err.message})`);
            return null;
        });
    const links = sparql ? [] : null;
    const seen = new Set();
    for (const row of sparql?.results?.bindings ?? []) {
        const linked = String(row.item?.value ?? '').split('/').pop();
        const relation = row.rel?.value;
        const label = row.itemLabel?.value;
        // an item without a label in any language read is named by its id: of no use to find news
        if (!isQid(linked) || linked === qid || !relation || !label || isQid(label) || seen.has(`${linked} ${relation}`)) continue;
        seen.add(`${linked} ${relation}`);
        links.push({qid: linked, label, description: row.itemDescription?.value ?? null, kind: LINKED_KIND[relation] ?? 'other', relation});
    }

    return {
        qid, kind,
        label: labels[0] ?? qid,
        description: valuesOf(item.descriptions, language)[0] ?? null,
        names: namesOf(labels, aliases, extra, {club: kind === 'club' || kind === 'team'}),
        links,
    };
};
