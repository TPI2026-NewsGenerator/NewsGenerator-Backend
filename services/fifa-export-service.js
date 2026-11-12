//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-export-service.js
//  Description: The news selected for the map "The FIFA presidency", as GET /api/v1/fifa/news gives them to the system of another party (the claims
//               graph of a friend), which judges them again, slower and more surely than we do. One item is one PASSAGE: the sentence of a news
//               that names an association and a candidate, with how we read it (certainty, stance, level, who speaks, the words held) and the news
//               it is in. A news that names two associations comes twice, with two ids. No AI here, no link that carries a key, none of our RSS-Bridge
//
//  A passage the other party read can change (the second model settles it, a rule of the guide is read again, more news tell it): it comes again
//  with the same id and a newer updated_at, and the other party replaces what it had. The cursor goes on from updated_at (see fifa-export-model.js)
//

"use strict"

import {FifaExportModel} from '../models/fifa-export-model.js';
import {MEMBERS} from './utils/fifa-members.js';
import {cleanText, encodeCursor, isShareable} from './news-export-service.js';

// established: a position that colours the map; uncertain: about the election and the association but not a position; discarded: read and left out
export const CERTAINTIES = ['established', 'uncertain', 'discarded'];
// what we select: the first two. The third is there for whoever wants to learn which passages we no longer select, or to measure what we left out
export const SELECTED = ['established', 'uncertain'];

const iso = (value) => value ? new Date(value).toISOString() : null;

// the association as the map names it: the item of Wikidata is the key, the rest is to be read by a person
const associationOf = (qid) => {
    const member = MEMBERS.get(qid);
    return member
        ? {qid, fifa: member.fifa, name: member.name, full_name: member.association ?? member.name, confederation: member.confederation ?? null, level: member.level}
        : {qid, fifa: null, name: null, full_name: null, confederation: null, level: null};
};

// query: {certainty, subjects, members, since, until, order, after, limit} (checked by the controller). {items, next_cursor, has_more, order}
export const FifaExportService = {
    list: async (query) => {
        const rows = await FifaExportModel.find(query);
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        // the next page goes on from the last passage read, shared or not, so that a page of passages left out does not stop it
        const last = page.at(-1);
        const items = page.filter(row => isShareable(row.url)).map(row => ({
            id: row.id,
            // when it last changed: a passage seen again with a newer one replaces the one the client has
            updated_at: row.seen,
            subject: {qid: row.subject_qid, name: row.subject_name},
            association: associationOf(row.member_qid),
            certainty: row.certainty,
            // why it is only uncertain: readings_disagree, praise, unconfirmed... (null for the others)
            uncertain_reason: row.certainty === 'uncertain' && row.uncertain_reason ? row.uncertain_reason : null,
            // how we read it: the stance toward the person (for, against, undecided, none), its level (declared: a bound speaker says it plainly;
            // probable: it follows from what is said), the mark (official: told plainly; reported: the text itself hedges), who speaks, the words
            // of the sentence that tell it (quote)
            reading: {
                stance: row.stance, level: row.level, mark: row.mark,
                speaker_kind: row.speaker_kind, speaker: row.speaker || null,
                quote: row.quote || null,
            },
            // the sentence of the news as published, and the words of the association that were found in it
            sentence: cleanText(row.sentence),
            matched: row.matched || null,
            news: {
                url: row.url,
                title: cleanText(row.title),
                description: cleanText(row.description),
                medium: row.medium,
                lang: row.lang,
                published_at: iso(row.published_at),
                // how many news and media told this same passage
                told_by: {news: row.news_count, media: row.media_count},
            },
        }));
        return {
            items,
            // always the one of the last passage read, even on the last page: it is what a client that follows the signals keeps to ask, the next day, for what
            // changed since. null only for a page with nothing in it, the client then keeps the one it has
            next_cursor: last ? encodeCursor(last.seen, last.id) : null,
            has_more: hasMore,
            order: query.order,
        };
    },
};
