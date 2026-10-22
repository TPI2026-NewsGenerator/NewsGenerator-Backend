//
//  Author: Fabian Rostello
//  Date: 22.10.2026
//  File: title-links.js
//  Description: The item of Wikidata of many names at once, by the title of an article of the Wikipedia of
//               their language, 50 names a call (Wikidata itself is searched one name every 7 seconds)
//

"use strict"

import {describeItems, wikimediaHeaders} from './wikidata.js';
import {mentionKey} from './mentions.js';
import {mediaOf} from './country-names.js';
import {familyName} from './person-items.js';
import {MentionModel} from '../../models/mention-model.js';

// Measured on 450 names linked in production (bench/title-batch, 22.10.2026): the Wikipedia of the language
// ("redirects": "Real Madrid" is "Real Madrid CF", "Lvmh" LVMH, which Wikidata's own titles lack) has an
// article of that title for 70% of the organisations, 79% of the persons, 81% of the places. Kept when it is
// no page of homonyms, the item is of the kind of the name (a person a human, a place no human nor work) and
// is called no common noun ("motorsport", "bus driver"): the persons 101 of 150, none different from
// production, 9 more linked, all right (James Rodríguez, Trey McBride); the places 89 of 150, 63 the same,
// 2 different, 24 more linked, 20 right ("Brücke" a group of artists and "National Football Stadium" a
// stadium of Papua New Guinea were not). The organisations 55 of 150, 3 of the 16 that differ or are new
// wrong ("Napoli" the city, "Sephora" a biblical name): the AI chooses for them (see organization-items.js).
// On 300 names of the queue (150 persons in full, 150 places, seen 3 times or more) 122 are linked, 41%
// (persons 51, places 71), judged by hand: persons 47 right, 1 wrong ("J.J. Roberts" a president of Liberia
// of 1809), 3 unsure; places 63 right, 5 wrong before the place filter, 2 after, 3 unsure
const TITLES = 50;
const PAUSE_MS = 300;
const WIKIS = {no: 'no', nb: 'no', iw: 'he', 'zh-cn': 'zh', 'zh-tw': 'zh'};
const DISAMBIGUATION = /disambiguation page|^Wikimedia (list|category|template)/i;
// what an item called a place is described as (a population or a position is not always known: a stadium has
// an owner, a bridge a builder): "Israelis", "Vedanta" a school of philosophy, "Gre" an examination, "10 de
// Agosto" a day of the year, "Sururu" a mollusc were no places (bench/title-batch/dry.mjs, 71 places of the
// queue: of 5 wrong 2 kept, of 66 right 63)
const PLACE_WORDS = /\b(country|sovereign|state|republic|kingdom|territory|region|province|city|town|village|capital|island|continent|municipality|commune|county|district|area|borough|neighbou?rhood|prefecture|canton|peninsula|desert|river|mountain|lake|sea|ocean|bay|strait|airport|port|settlement|urban|metropolitan|parish|archipelago|enclave|department|oblast|governorate|emirate|stadium|arena|bridge|park|castle|prison|ski|section|suburb|road|motorway|venue|palace|base|center|centre|resort|monastery|hill|valley|forest|beach|coast)\b/i;

const hostOf = (lang) => `${WIKIS[lang] ?? lang ?? 'en'}.wikipedia.org`;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Map title asked -> {qid, title, disambiguation} for these titles of a Wikipedia: normalized, redirected,
// the pages that have an item. Nothing for a host that does not answer (a language Wikipedia has not)
const pagesOf = async (host, titles) => {
    const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({action: 'query', titles: titles.join('|'), redirects: '1',
        prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', format: 'json', formatversion: '2'})}`,
    {headers: wikimediaHeaders(), signal: AbortSignal.timeout(15000)});
    if (!res.ok) return new Map();
    const query = (await res.json()).query;
    if (!query) return new Map();
    const normalized = new Map((query.normalized ?? []).map(row => [row.from, row.to]));
    const redirected = new Map((query.redirects ?? []).map(row => [row.from, row.to]));
    const pages = new Map((query.pages ?? []).filter(page => !page.missing && page.pageprops?.wikibase_item).map(page => [page.title, page]));
    const found = new Map();
    for (const asked of titles) {
        const title = redirected.get(normalized.get(asked) ?? asked) ?? normalized.get(asked) ?? asked;
        const page = pages.get(title);
        if (page) found.set(asked, {qid: page.pageprops.wikibase_item, title: page.title, disambiguation: page.pageprops.disambiguation !== undefined});
    }
    return found;
};

// Map mention id -> {qid, title, disambiguation} of these rows ({id, name, lang}): in the Wikipedia of their
// language, then in English for the ones not found there
export const articlesOf = async (rows) => {
    const found = new Map();
    const search = async (list, hostFor) => {
        const groups = new Map();
        for (const row of list) groups.set(hostFor(row), [...(groups.get(hostFor(row)) ?? []), row]);
        for (const [host, group] of groups) {
            for (let i = 0; i < group.length; i += TITLES) {
                const part = group.slice(i, i + TITLES);
                const pages = await pagesOf(host, [...new Set(part.map(row => row.name.trim()))]).catch(() => new Map());
                for (const row of part) if (pages.has(row.name.trim())) found.set(row.id, pages.get(row.name.trim()));
                await wait(PAUSE_MS);
            }
        }
    };
    await search(rows, row => hostOf(row.lang));
    await search(rows.filter(row => !found.has(row.id) && (row.lang ?? 'en') !== 'en'), () => hostOf('en'));
    return found;
};

// whether this item may be what a name of this kind is
const ofKind = (kind, item) => kind === 'person' ? item.human : !item.human && !item.work && (item.place || PLACE_WORDS.test(item.description ?? ''));

// Map mention id -> qid of the persons in full and the places among these rows ({id, name, kind, lang})
// whose name is the title of an article of their Wikipedia, kept as measured above. Whatever it cannot tell
// (no article, a page of homonyms, another kind of item, a family name after a particle, a name one site
// writes) is left out, to be searched name by name; Wikipedia or Wikidata failing throws
export const linkedByTitle = async (rows) => {
    const own = rows.filter(row => row.kind === 'location' || (row.kind === 'person' && mentionKey(row.name).includes(' ') && !familyName(row.name)));
    if (own.length === 0) return new Map();
    const articles = await articlesOf(own);
    const asked = own.filter(row => articles.has(row.id) && !articles.get(row.id).disambiguation);
    if (asked.length === 0) return new Map();
    const items = new Map();
    const qids = [...new Set(asked.map(row => articles.get(row.id).qid))];
    for (let i = 0; i < qids.length; i += TITLES) {
        for (const item of await describeItems(qids.slice(i, i + TITLES), {batch: TITLES})) items.set(item.qid, item);
    }
    const linked = new Map();
    for (const row of asked) {
        const item = items.get(articles.get(row.id).qid);
        if (!item || !ofKind(row.kind, item) || /^\p{Ll}/u.test(item.label ?? '') || DISAMBIGUATION.test(item.description ?? '')) continue;
        // a byline ("Mohammed Ibrahim" of a sports site) is not the person of that name (see tagging-service.js)
        if (row.kind === 'person' && mediaOf(await MentionModel.sitesNaming(row.id)).byline) continue;
        linked.set(row.id, item.qid);
    }
    return linked;
};
