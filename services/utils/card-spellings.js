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
// An acronym the news write in Latin letters (LNFP, FKF, UEFA) is kept as written by the translation and needs no spelling: it is left out of what
// a translation is told. The tagger links a name by its text alone, whatever the card: "LNFP" was the league of Honduras for the card of the
// Moroccan federation, and its title was translated "...the role of the Liga Nacional de Fútbol de Honduras" (the briefing of Enzo 656 of
// 10.11.2026). The check of the names took the link away afterwards, too late for the words already written
const LATIN_ACRONYM = /^[A-Z][A-Z0-9&]{1,6}$/;

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
                if (!ids.has(row.id_article) || !spelled || LATIN_ACRONYM.test(row.name)) continue;
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

// The texts of a card translated with a label of Wikidata that the check of the names then refused: the glossary the translation was told had
// "written -> spelled" for a link the tagger made by the text of the name, and the final names of the card have that name with no item. The
// label put there is the written name again in the words the translation made (the title, the passages, the points, the summary, the AI's
// version), unless the article itself (the text as it was written) has the label. A card with no such name is the same object
const TRANSLATED = ['titleTranslation', 'translation', 'pointsTranslation', 'digestTranslation'];
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const withoutUntrustedLabels = (card, glossary = []) => {
    const unlinked = new Set((card.names ?? []).filter(name => !name.qid).map(name => mentionKey(name.name)));
    const pairs = glossary.filter(pair => pair?.written && pair?.spelled && unlinked.has(mentionKey(pair.written)));
    if (pairs.length === 0) return card;
    const original = [card.title, card.summary, card.points, card.digest].filter(Boolean).join('\n').toLowerCase();
    let changed = false;
    const put = (text) => {
        if (typeof text !== 'string') return text;
        let out = text;
        for (const {written, spelled} of pairs) {
            if (original.includes(spelled.toLowerCase())) continue;
            // "the LNFP (LNFP)": the translation had spelled it out and then given the acronym
            out = out.replace(new RegExp(escaped(spelled), 'gi'), written).replace(new RegExp(`${escaped(written)} \\(${escaped(written)}\\)`, 'g'), written);
        }
        if (out !== text) changed = true;
        return out;
    };
    const fixed = {...card, ...Object.fromEntries(TRANSLATED.filter(key => card[key]).map(key => [key, put(card[key])]))};
    if (card.ai) fixed.ai = {...card.ai, ...(card.ai.points ? {points: card.ai.points.map(put)} : {}), ...(card.ai.summary ? {summary: put(card.ai.summary)} : {})};
    return changed ? fixed : card;
};
