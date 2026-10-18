//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: organization-items.js
//  Description: The item of Wikidata an organisation the news name is: the one called so when it is the
//               only one, else the one the AI chooses among the items called so or whose name starts so,
//               from the titles of news naming it
//

"use strict"

import {describeItems, namedItems} from './wikidata.js';
import {ollamaJson} from './ollama.js';
import {MentionModel} from '../../models/mention-model.js';

// Measured on 60 organisations often met and never linked (18.10.2026): one item called so left FIFA (an
// album, a song of the same name), Juventus ("Juventus FC"), Liverpool (the city first) unlinked. Told
// apart by their Wikipedias, ~80% right (Roma the HBO series); by the closeness of their description to
// the news, 7 of 16. The AI chose 50 times, 45 right; keeping the items in MIN_SITELINKS Wikipedias at
// least, 44 of 46 (a PSG omnisport club in 4, the women's team of Como 1907 in 6 left out), about 390
// tokens a name
export const MIN_SITELINKS = 10;
const TITLES = 5;

export const organizationPrompt = (name, titles, items) => `A name in the news: "${name}".

Titles of news naming it:
${titles.map(title => `- ${title}`).join('\n')}

Items of Wikidata called so:
${items.map((item, i) => `[${i + 1}] ${item.label}: ${item.description || '(no description)'} (${item.links} Wikipedias)`).join('\n')}

Which item is the "${name}" these news name? Only when you are sure from the titles: a club, a company, a
league, a body these news are about. 0 when none of them is, when you cannot tell, or when the name is
only a part of many names ("FC", "Club", "United").
Answer in JSON only: {"n": 0}`;

// the qid of an organisation ({id, name, lang} of mentions), null when none can be told; usage: the
// tokens the AI took, counted in it
export const organizationItem = async ({id, name, lang}, usage = null) => {
    const found = await namedItems(name, lang ?? 'en');
    const exact = found.filter(item => item.exact);
    if (exact.length === 1) return exact[0].qid;
    if (found.length === 0) return null;
    const items = (await describeItems(found.map(item => item.qid))).filter(item => !item.human);
    const titles = items.length === 0 ? [] : await MentionModel.titlesNaming(id, TITLES);
    if (titles.length === 0) return null;
    const answer = await ollamaJson(organizationPrompt(name, titles, items), usage);
    const chosen = items[Number(answer?.n) - 1];
    return chosen && chosen.links >= MIN_SITELINKS ? chosen.qid : null;
};
