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
import {mentionKey} from './mentions.js';

export {isQid};

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
// Wikimedia asks every client to name itself
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (self-hosted news reader)', Accept: 'application/json'};
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

const ask = async (url) => {
    if (Date.now() < pausedUntil) throw Object.assign(new Error('Wikidata asked to wait.'), {status: 502, paused: true});
    const res = await fetch(url, {headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS)});
    if (res.status === 429) {
        pausedUntil = Date.now() + (Number(res.headers.get('retry-after')) * 1000 || PAUSE_MS);
        throw Object.assign(new Error('Wikidata asked to wait.'), {status: 502, paused: true});
    }
    if (!res.ok) throw Object.assign(new Error(`Wikidata answered ${res.status}.`), {status: 502});
    return res.json();
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
    return [...new Set((answer.search ?? [])
        .filter(item => isQid(item.id) && !NOT_NAMED.test(item.description ?? '')
            && mentionKey(item.match?.text ?? item.label) === key)
        .map(item => item.id))];
};

// A person named as several items are: the one of them who is a human (P31 Q5) and is in far more
// Wikipedias than any other (sitelinks), the famous one. A famous name has the most namesakes: "David
// Beckham" a Canadian candidate, "Donald Trump" songs. On 40 names often met and never linked (18.10.2026)
// the persons were all told right (Trump 334 against 6, Messi 226 against 0, Lula 150 against 13), and
// "Michael Oliver" (the referee among 9) left alone. null when none stands out
export const MIN_SITELINKS = 10;
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
