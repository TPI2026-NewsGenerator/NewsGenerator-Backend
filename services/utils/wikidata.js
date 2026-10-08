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

const ask = async (url) => {
    const res = await fetch(url, {headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS)});
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

// {qid, label, description, kind, names, links: [{qid, label, description, kind, relation}]}, null
// when Wikidata has no such item
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

    const sparql = await ask(`${SPARQL}?${new URLSearchParams({format: 'json', query: linksQuery(qid, kind, language)})}`)
        .catch(err => {
            console.error(`Wikidata: the links of ${qid} were not read (${err.message})`);
            return {results: {bindings: []}};
        });
    const links = [];
    const seen = new Set();
    for (const row of sparql.results?.bindings ?? []) {
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
