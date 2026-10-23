//
//  Author: Fabian Rostello
//  Date: 23.10.2026
//  File: wikipedia-search.js
//  Description: The items of Wikidata of the first pages a Wikipedia finds for a text (the search of the
//               Wikipedia, not Wikidata's: it knows "FMF Madagascar" where Wikidata's search of "FMF" finds
//               a disease, a gene and the Mexican federation)
//

"use strict"

import {wikimediaHeaders} from './wikidata.js';

const FOUND = 5;
const TIMEOUT_MS = 15000;

// [qid] of the first FOUND pages of this Wikipedia for this text that have an item and are no page of homonyms,
// in the order of the Wikipedia. A refusal (429), a failure or no answer: none (what is searched is a help for a
// choice, never a reason to fail a briefing). Measured on the names the check of a card sent away
// (bench/relink-after-no): 5 of 12 got the right item, none a wrong one
export const searchedItems = async (text, host = 'en.wikipedia.org') => {
    try {
        const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({action: 'query', generator: 'search', gsrsearch: String(text).slice(0, 200),
            gsrnamespace: '0', gsrlimit: String(FOUND), prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', format: 'json', formatversion: '2'})}`,
        {headers: wikimediaHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS)});
        if (!res.ok) return [];
        return ((await res.json()).query?.pages ?? []).sort((a, b) => a.index - b.index)
            .filter(page => page.pageprops?.wikibase_item && page.pageprops.disambiguation === undefined)
            .map(page => page.pageprops.wikibase_item);
    } catch {
        return [];
    }
};
