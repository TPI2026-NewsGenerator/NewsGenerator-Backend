//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: briefing-export-service.js
//  Description: The news the briefings of all the readers chose, as GET /api/v1/briefing/news gives them to the system of another party (the claims
//               graph of a friend), which judges them again, slower and more surely than we do. One item is one STORY (a card): its articles, the
//               key passages of its lead article as published, and what our code and our AI found around it (how many media tell it and how
//               many wrote apart, the words that hedge, who denies it, the posts of the parties). No AI here
//
//  Nothing that says who read it or why it was chosen for them: no reader, no profile, no interest, no thumb, no sending date, no AI wording, no
//  translation, no card a reader added. Only how many briefings and readers chose the story. No link that carries a key, none of our RSS-Bridge
//

"use strict"

import {Buffer} from 'node:buffer';
import {BriefingExportModel} from '../models/briefing-export-model.js';
import {cleanText, isShareable} from './news-export-service.js';

const MAX_LIST = 5;
// A card can hold a hundred articles (269 in a story of the World Cup): the lead first, then the ones the card shows first, 20 at most; articles_total says how many there are
const MAX_ARTICLES = 20;

const text = (value) => typeof value === 'string' && value.trim() !== '' ? value : null;
const iso = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

// the cursor: where the last card read was, opaque for whoever reads it
export const encodeCursor = (seen, briefing, position) => Buffer.from(`${seen}|${briefing}|${position}`).toString('base64url');
export const decodeCursor = (value) => {
    try {
        const [seen, briefing, position] = Buffer.from(value, 'base64url').toString('utf8').split('|');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(seen) || !/^\d{1,10}$/.test(briefing) || !/^\d{1,6}$/.test(position) || Number.isNaN(Date.parse(seen))) return null;
        return {seen, briefing: Number(briefing), position: Number(position)};
    } catch {
        return null;
    }
};

// an article of the card as the other party reads it: no mark of the reader (trusted)
const articleOf = (article) => ({
    url: article.url,
    title: cleanText(article.title),
    medium: text(article.source),
    language: text(article.language),
    published_at: iso(article.publishedAt),
});

// the articles of the card that can be given, its lead first, each address once
const articlesOf = (card) => {
    const seen = new Set();
    return [card.lead, ...(Array.isArray(card.articles) ? card.articles : [])]
        .filter(article => article && typeof article.url === 'string' && isShareable(article.url) && !seen.has(article.url) && seen.add(article.url))
        .map(articleOf);
};

// what a party said or what a medium reports against the news, one line each: the sentence or the title, who, where, the page (when it can be given)
const pageOf = (url) => typeof url === 'string' && isShareable(url) ? url : null;
const deniedBy = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_LIST).map(entry => ({
    by: text(entry?.by), sentence: cleanText(entry?.sentence), medium: text(entry?.source), url: pageOf(entry?.url), published_at: iso(entry?.publishedAt),
}));
const officialPosts = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_LIST).map(entry => ({
    party: text(entry?.party), title: cleanText(entry?.title), channel: text(entry?.channel), url: pageOf(entry?.url), published_at: iso(entry?.publishedAt),
}));

// the passages of a card: a paragraph each in what the card kept (see extract.js)
const MAX_PASSAGES = 8;
export const passagesOf = (summary) => typeof summary === 'string'
    ? summary.split(/\n+/).map(cleanText).filter(Boolean).slice(0, MAX_PASSAGES)
    : [];

// the card, null when none of its articles can be given
export const itemOf = (row) => {
    const card = row.card ?? {};
    const articles = articlesOf(card);
    if (articles.length === 0) return null;
    const corroboration = card.corroboration ?? {};
    return {
        // the story: what a verdict of the other party is sent for. A card that joined stories carries the ids of the others too
        id: row.story,
        merged_story_ids: (Array.isArray(card.mergedStoryIds) ? card.mergedStoryIds : []).filter(Number.isInteger),
        // when the briefing that chose it was ready; how many readers have it in a briefing (counted as of this answer)
        selected_at: row.seen,
        readers: row.readers,
        language: text(card.language),
        // the lead article first, as published (the title of the card, which may be a rewrite of ours, is not given)
        articles: articles.slice(0, MAX_ARTICLES),
        articles_total: articles.length,
        // the sentences of the lead article the card was written from, word for word as published, one passage each: the heart of the news as we read it
        key_passages: passagesOf(card.summary),
        // what we found around it. hedged_by: the word the article itself used to say it has no confirmation (null when it states its news plainly);
        // corroboration: media tell it, read the ones whose text could be read, independent the ones written apart from the others (never above read)
        reading: {
            topic: text(card.topic),
            sourcing: text(card.sourcing),
            hedged_by: text(card.hedged),
            corroboration: {
                media: Number.isInteger(corroboration.media) ? corroboration.media : null,
                read: Number.isInteger(corroboration.read) ? corroboration.read : null,
                independent: Number.isInteger(corroboration.independent) ? corroboration.independent : null,
                agencies: Array.isArray(corroboration.agencies) ? corroboration.agencies.filter(name => typeof name === 'string').slice(0, MAX_LIST) : [],
            },
            denied_by: deniedBy(card.contested),
            official_posts: officialPosts(card.official),
        },
        names: (Array.isArray(card.names) ? card.names : []).slice(0, 15).map(name => ({name: text(name?.name), qid: text(name?.qid), kind: text(name?.kind)})).filter(name => name.name),
    };
};

export const BriefingExportService = {
    // query: {since, until, topics, dedupe, order, after, limit} (checked by the controller). {items, next_cursor, has_more, order, dedupe}
    list: async (query) => {
        const rows = await BriefingExportModel.find(query);
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        // the next page goes on from the last card read, given or not, so that a page of cards left out does not stop it
        const last = page.at(-1);
        return {
            items: page.map(itemOf).filter(Boolean),
            // always the one of the last card read, even on the last page: it is what a client that follows the briefings keeps to ask, the next day, for
            // what came since. null only for a page with nothing in it, the client then keeps the one it has
            next_cursor: last ? encodeCursor(last.seen, last.briefing, last.position) : null,
            has_more: hasMore,
            order: query.order,
            dedupe: query.dedupe,
        };
    },
};
