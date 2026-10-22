//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: organization-items.js
//  Description: The item of Wikidata an organisation the news name is: the one called so when it is the
//               only one and may be a body, else the one the AI chooses among the items called so or
//               whose name starts so, from the titles of news naming it
//

"use strict"

import {describeItems, namedItems} from './wikidata.js';
import {ollamaJson} from './ollama.js';
import {MentionModel} from '../../models/mention-model.js';
import {countriesOfItems} from './countries.js';
import {ofOtherCountry} from './country-names.js';

// Measured on 60 organisations often met and never linked (18.10.2026): one item called so left FIFA (an
// album, a song of the same name), Juventus ("Juventus FC"), Liverpool (the city first) unlinked. Told
// apart by their Wikipedias, ~80% right (Roma the HBO series); by the closeness of their description to
// the news, 7 of 16. The AI chose 50 times, 45 right; keeping the items in MIN_SITELINKS Wikipedias at
// least, 44 of 46 (a PSG omnisport club in 4, the women's team of Como 1907 in 6 left out), about 390
// tokens a name
export const MIN_SITELINKS = 10;
// The one item called so, whatever it was, measured on 122 organisations linked to it, judged by hand
// (bench/lone-organizations, 20.10.2026): 93 right, 6 of the right country only (the town of a club:
// Tottenham), 23 wrong ("Al-Hazm", the Saudi club, a settlement in Oman; "EU" the commune of Eu, in 57
// Wikipedias; "Jambos", Hearts, a genus of plants; "Fivers" an album). Taken only when it is no human, no
// place, no work and in LONE_SITELINKS Wikipedias at least, else the AI chooses as among several, and the
// item it chooses is kept from 1 Wikipedia (it agrees with the news): 96 right, 3 of the country, 1 wrong
// (ENC, the École des chartes), 6 lost (the AI says none for PFL Chicago, Verifactu, the Nigerian students'
// union, gut bacteria; Lamine Yamal is a human). A Wikipedia at least, 3 wrong (Pogacar an article of an
// encyclopedia, Scarlet Knights comic book characters); 3, one more lost. The AI asked for every one: none wrong, but 12 lost (Shakhtar Donetsk,
// the FIFA Council: "only when you are sure") and 5 times the calls; with this rule 1 lone item in 5 is
// asked to it
export const LONE_SITELINKS = 2;
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

// whether the one item called so may be the organisation without asking the AI
const mayBeBody = (item) => item && !item.human && !item.place && !item.work && item.links >= LONE_SITELINKS;

// whether the sites naming the name are of another country than the item (see country-names.js
// ofOtherCountry): then the AI reads the titles. Not read from Wikidata, or an international body: no
const elsewhere = async (id, qid) => {
    const country = (await countriesOfItems([qid], {background: true})).get(qid);
    return Boolean(country?.country) && !country.international && ofOtherCountry(await MentionModel.sitesNaming(id), country.country);
};

// the qid of an organisation ({id, name, lang} of mentions), null when none can be told; usage: the
// tokens the AI took, counted in it; candidates: an array the qids found are added to (kept by the link loop when
// there is no answer, for a card to choose among them)
export const organizationItem = async ({id, name, lang}, usage = null, candidates = null) => {
    const found = await namedItems(name, lang ?? 'en');
    candidates?.push(...found.map(item => item.qid));
    if (found.length === 0) return null;
    const exact = found.filter(item => item.exact);
    const described = await describeItems(found.map(item => item.qid));
    const lone = exact.length === 1 ? described.find(item => item.qid === exact[0].qid) : null;
    if (mayBeBody(lone) && !(await elsewhere(id, lone.qid))) return lone.qid;
    const items = described.filter(item => !item.human);
    const titles = items.length === 0 ? [] : await MentionModel.titlesNaming(id, TITLES);
    if (titles.length === 0) return null;
    const answer = await ollamaJson(organizationPrompt(name, titles, items), usage);
    const chosen = items[Number(answer?.n) - 1];
    return chosen && chosen.links >= (exact.length === 1 ? 1 : MIN_SITELINKS) ? chosen.qid : null;
};
