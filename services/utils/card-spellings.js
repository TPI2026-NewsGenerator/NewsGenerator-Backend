//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: card-spellings.js
//  Description: How Wikidata spells the names the news of a card name. The tagger finds a name in an
//               article (in Greek, in Cyrillic...) and links it to an item of Wikidata, which has a label
//               in the Latin alphabet: told to the translation of the card, it does not guess the spelling
//               of "Φραπάρ" (see spellings.js)
//

"use strict"

import {MentionModel} from '../../models/mention-model.js';
import {describeItems} from './wikidata.js';
import {mentionKey} from './mentions.js';
import {memo} from './memo.js';

// the names read for all the cards of a briefing, at most (30 cards of 10 news naming 8 items each: 2 400)
const MAX_NAMES = 4000;
// a card is told of its first names
const PER_CARD = 12;
const DAY_MS = 24 * 3600e3;
// qid -> its label in English, '' when it has none: asked once a week
const labels = memo({ttlMs: 7 * DAY_MS, max: 5000});
// a label in the Latin alphabet only: one that is Greek or Chinese tells nothing to a reader of English
const LATIN_LABEL = /^[\p{Script=Latin}\p{N}\p{M}\s.'’&,-]+$/u;

const spelledOf = (qid) => {
    const label = labels.get(qid);
    return label && LATIN_LABEL.test(label) ? label : null;
};

// the labels of these items not known yet, asked of Wikidata 50 at a time, in the background
const readLabels = async (qids) => {
    const missing = [...new Set(qids)].filter(qid => labels.get(qid) === undefined);
    for (let i = 0; i < missing.length; i += 50) {
        const asked = missing.slice(i, i + 50);
        const found = new Map((await describeItems(asked, {background: true, batch: 50})).map(item => [item.qid, item.label]));
        // a label that is the id itself: Wikidata has none in English
        for (const qid of asked) labels.set(qid, found.has(qid) && found.get(qid) !== qid ? found.get(qid) : '');
    }
};

// Map qid -> label of these items, the ones Wikidata spells in the Latin alphabet: what the translation of a card spells their names
// with, and what the names a card shows are spelled with too (the chip said "Ceferin" and the text "Čeferin", 8.11.2026). Throws when
// Wikidata or the database does not answer
export const labelsOfItems = async (qids) => {
    await readLabels(qids);
    return new Map([...new Set(qids)].map(qid => [qid, spelledOf(qid)]).filter(([, label]) => label));
};

// Map storyId -> {glossary, names}: of the news of these stories, the names that are an item of Wikidata.
// glossary [{written, spelled}]: the ones not written as it spells them ("Φραπάρ" is "Stéphanie Frappart"),
// each item once, the most met first; names: the labels of all of them, the ones another medium of the card,
// in another language, writes in Latin letters as well ("Stéphane Lannoy" for a news in Greek that has none).
// stories: [{storyId, members: [{id}]}]. Wikidata is asked once for all the names (50 an item), in the
// background: when it does not answer, or the database does not, no card is told anything: the briefing
// never waits on it
export const glossariesOfStories = async (stories) => {
    const glossaries = new Map();
    try {
        const rows = await MentionModel.linkedNamesOf(stories.flatMap(story => story.members.map(article => article.id)), MAX_NAMES);
        await readLabels(rows.map(row => row.qid));
        for (const story of stories) {
            const ids = new Set(story.members.map(article => article.id));
            // each item with the news of the card naming it, and the writings of it
            const items = new Map();
            for (const row of rows) {
                const spelled = spelledOf(row.qid);
                if (!ids.has(row.id_article) || !spelled) continue;
                const item = items.get(row.qid) ?? {spelled, news: new Set(), writings: new Map()};
                item.news.add(row.id_article);
                item.writings.set(row.name, (item.writings.get(row.name) ?? 0) + 1);
                items.set(row.qid, item);
            }
            const first = [...items.values()].sort((a, b) => b.news.size - a.news.size).slice(0, PER_CARD);
            // a pair for each item that a news writes otherwise than its label: the writing of it met the most
            const glossary = first.flatMap(item => {
                const written = [...item.writings].filter(([name]) => mentionKey(name) !== mentionKey(item.spelled)).sort((a, b) => b[1] - a[1])[0];
                return written ? [{written: written[0], spelled: item.spelled}] : [];
            });
            if (first.length > 0) glossaries.set(story.storyId, {glossary, names: first.map(item => item.spelled)});
        }
    } catch (err) {
        console.error(`Briefing: the spelling of the names was not asked of Wikidata (${err.message})`);
    }
    return glossaries;
};
