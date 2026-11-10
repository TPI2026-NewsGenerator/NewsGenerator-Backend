//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: news-export-service.js
//  Description: The news kept that name a person and/or an association, as /api/v1/news gives them to the system of
//               another party (the claims graph of a friend): the news as they are (title, start of the description,
//               link), how big the story each belongs to is, why it was found, and optionally the names the tagger
//               found and the marks of a statement, a denial or a hedge. No AI here: the other party reads the news
//               its own way. No link that carries a key, none of our RSS-Bridge
//
//  What is asked is found by (1) the item of Wikidata the tagger linked in the news, in every script, and (2)
//  words in the title and the description, for the scripts the index of trigrams serves: it is far faster than
//  a scan of the news (0.0 s against 40 s for Japanese, bench of 10.11.2026), and a name in Chinese, Japanese or
//  Korean is only found by its item
//

"use strict"

import {Buffer} from 'node:buffer';
import process from 'node:process';
import {NewsExportModel} from '../models/news-export-model.js';
import {associationsOfCountry} from './utils/football-associations.js';
import {hasDenial} from './utils/contested.js';
import {hedgedBy} from './utils/hedging.js';
import {hasStatement} from './utils/statements.js';
import {isBridgeUrl} from './utils/public-url.js';
import {SECRET_PARAMS} from './utils/feed-limits.js';

// the news are kept this long (see feed-service.js): a first call gives all of it, a reader must come back before it is gone
export const RETENTION_DAYS = Number(process.env.FEED_RETENTION_DAYS) || 30;
const MAX_TEXT = 1500;

const fail = (status, code, message, parameter) => Object.assign(new Error(message), {status, code, ...(parameter ? {parameter} : {})});

// the text as it is compared: no accents, small letters
const plain = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const stripped = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '');
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The scripts the index of trigrams serves: a word in another (Chinese, Japanese, Korean, Thai...) is a scan of every news, 40 s, and is only read
// in the news of the associations asked (see the model)
const SERVED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{N}\s'’.-]+$/u;
export const isServed = (term) => SERVED.test(term);

// The regex of Postgres of each word, as a word on its own ("vega" is not in "Las Vegas"), with its form without accents
// too ("Arsène" finds "Arsene"). One each, searched apart (see the model): never one long alternation
export const regexesOfTerms = (terms) => terms.map(term => {
    const forms = [...new Set([term, stripped(term)])];
    return `\\m(${forms.map(escaped).join('|')})\\M`;
});

// the words of another script, as they are written: no word boundary in a text that has no blanks between its words
export const regexesOfScanTerms = (terms) => terms.map(escaped);

// the text of a description without its tags, its entities, its blanks, and not too long
export const cleanText = (html) => {
    const text = String(html ?? '').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
        .replace(/\s+/g, ' ').trim();
    return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT).replace(/\s+\S*$/, '')} …`;
};

// A link another system may be given: a page of the web, with no login in its address and no parameter that names a secret
// ("?token=", "?key=", see feed-limits.js), not one of our RSS-Bridge. Not looksPrivate, written for the address of a FEED, where a long
// random part is a key of its reader: on an article it is the address of a public page, and it left out 30% of 2000 news of Infantino
// (606, all by that heuristic, none with a secret in it: 478 links of Google News and long slugs of ordinary sites, 10.11.2026)
export const isShareable = (link) => {
    let url;
    try {
        url = new URL(link);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (isBridgeUrl(link) || url.username || url.password) return false;
    return ![...url.searchParams.keys()].some(name => SECRET_PARAMS.test(name));
};

// the cursor: where the last news seen was, opaque for whoever reads it
export const encodeCursor = (seen, id) => Buffer.from(`${seen}|${id}`).toString('base64url');
export const decodeCursor = (value) => {
    try {
        const [seen, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(seen) || !/^\d{1,10}$/.test(id) || Number.isNaN(Date.parse(seen))) return null;
        return {seen, id: Number(id)};
    } catch {
        return null;
    }
};

// the words of a news found among the terms asked, and the items of Wikidata among the ones asked
const termsIn = (row, terms) => {
    const text = plain(`${row.title} ${row.description}`);
    return terms.filter(term => isServed(term)
        ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped(plain(term))}(?![\\p{L}\\p{N}])`, 'u').test(text)
        : text.includes(plain(term)));
};

export const NewsExportService = {
    // query: {persons, terms, associations, countries, langs, media, excludedMedia, since, until, hasText, dedupe, order, after, limit, include: Set}
    // (checked by the controller). {items, next_cursor, has_more, retention_days, order}
    list: async (query) => {
        // a country is the associations of Wikidata it has, one set with the associations asked
        const fromCountries = query.countries.flatMap(code => {
            const found = associationsOfCountry(code);
            if (found.length === 0) throw fail(422, 'invalid_parameter', `country: ${code} is the code of no country that has an association of FIFA.`, 'country');
            return found.map(item => item.qid);
        });
        const associations = [...new Set([...query.associations, ...fromCountries])];

        const rows = await NewsExportModel.find({
            persons: query.persons, terms: regexesOfTerms(query.terms.filter(isServed)), scanTerms: regexesOfScanTerms(query.terms.filter(term => !isServed(term))), associations,
            langs: query.langs, media: query.media, excludedMedia: query.excludedMedia,
            since: query.since, until: query.until, hasText: query.hasText,
            dedupe: query.dedupe, order: query.order, after: query.after, limit: query.limit,
        });
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        // the next page goes on from the last news read, shared or not, so that a page of news left out does not stop it
        const last = page.at(-1);
        const shared = page.filter(row => isShareable(row.link));
        const ids = shared.map(row => row.id);

        const [stories, linked, entities] = await Promise.all([
            NewsExportModel.storiesOf([...new Set(shared.map(row => row.id_story).filter(id => id !== null))]),
            NewsExportModel.linkedAmong(ids, [...query.persons, ...associations]),
            query.include.has('entities') ? NewsExportModel.entitiesOf(ids) : [],
        ]);
        const storyOf = new Map(stories.map(story => [story.id, story]));
        const linkedBy = Map.groupBy(linked, row => row.id);
        const entitiesOf = Map.groupBy(entities, row => row.id);

        const items = shared.map(row => {
            const found = (linkedBy.get(row.id) ?? []).map(item => item.qid);
            const description = cleanText(row.description);
            const story = row.id_story === null ? null : storyOf.get(row.id_story);
            return {
                id: row.id,
                title: cleanText(row.title),
                description,
                url: row.link,
                medium: row.medium,
                lang: row.lang,
                published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
                seen_at: new Date(row.created_at).toISOString(),
                // the same news told by other articles of other media: one story, how many articles and media
                story: story ? {id: story.id, size: story.size, media: story.media} : null,
                // why it was found: the items asked that the tagger linked in it, the words asked that are in it
                matched: {
                    person: query.persons.filter(qid => found.includes(qid)),
                    association: associations.filter(qid => found.includes(qid)),
                    terms: termsIn({title: row.title, description}, query.terms),
                },
                ...(query.include.has('entities') ? {entities: (entitiesOf.get(row.id) ?? []).slice(0, 40).map(({name, kind, qid}) => ({name, kind, qid}))} : {}),
                ...(query.include.has('marks') ? {marks: marksOf(row, description)} : {}),
            };
        });
        return {
            items,
            // always the one of the last news read, even on the last page: it is what a client that follows the news keeps to ask,
            // the next day, for what came since. null only for a page with nothing in it, the client then keeps the one it has
            next_cursor: last ? encodeCursor(last.seen, last.id) : null,
            has_more: hasMore,
            retention_days: RETENTION_DAYS,
            order: query.order,
        };
    },
};

// What the words of the news say, no more: a statement or a release, a denial, a hedge ("reportedly", "would"). The detectors of the
// cards (statements.js, contested.js, hedging.js): a way to look first at the news that say something, not a verdict
const marksOf = (row, description) => {
    const text = `${row.title}. ${description}`;
    return {statement: hasStatement(text), denial: hasDenial(text, row.lang), hedged: hedgedBy(row.title, description)};
};
