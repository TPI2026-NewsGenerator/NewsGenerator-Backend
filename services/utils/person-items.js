//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: person-items.js
//  Description: Whether a person the news name is the one item of Wikidata called so: a human known
//               enough is, one in no Wikipedia only when the AI finds the titles of their news fit it
//

"use strict"

import {describeItems, PERSON_SITELINKS, readCountries} from './wikidata.js';
import {ollamaJson} from './ollama.js';
import {mentionKey} from './mentions.js';
import {MentionModel} from '../../models/mention-model.js';

// Measured on persons linked to the one item called so, in 0 to 9 Wikipedias, judged by hand (bench/lone-items,
// 20.10.2026): of the 60 most met 3 wrong, of 60 at random 8, of 40 at random in no Wikipedia 23 ("Eduardo
// Varela", a Uruguayan referee, a Mexican journalist; Kim Jong Un a song of Lacrim; footballers
// "researchers"): 123 right, 38 wrong. No human is always wrong ("one person", "Le conducteur": 17 of 17);
// in 1 Wikipedia at least 105 right, 2 wrong, but 17 right ones in none lost; the AI asked for the ones in
// none kept 11, all right. A family name after a particle ("De Roon", "De Luca", "Van Hecke": botanists,
// a Flemish painter) is no full name: the AI said no to 6 of 6, yes to La Joaqui. All: 116 right, none
// wrong, 6 lost (items with no description: Christine Villemin). The country of the media told nothing:
// most news are of a .com, the American players of sports.yahoo.com "Canadian" (18 right lost)
// A word alone ("Evenepoel", "Esposito", "Pedri") is a family name or a mononym. Its one item called so was
// wrong 87 times of 174 judged by hand on their news (bench/single-words, 21.10.2026): a botanist for Feijóo,
// a painter for Evenepoel, the actor Giancarlo Esposito for the footballers. The card tells a family name by
// the person linked in full that ends with it (card-names.js withSurnamesLinked), only when the word has no
// link of its own: the wrong one stopped it. So the word keeps its item only when the item is called so (its
// label) and is in WORD_SITELINKS Wikipedias at least (Pedri, Deco, Sheamus): 107 right, 7 wrong, 60 with
// none (the card told most of them), against 87 right and 87 wrong, and 96 right, 6 wrong, 72 none with no
// link at all. The 5 more right ones lost 40 Wikipedias at least, 11 more wrong at 10
export const WORD_SITELINKS = 20;
const TITLES = 5;
const PARTICLES = new Set(['de', 'di', 'da', 'du', 'del', 'della', 'dos', 'das', 'van', 'von', 'der', 'den', 'ten', 'ter', 'le', 'la']);

// "De Roon", "Van Dijk": a family name alone, read as a full name
export const familyName = (name) => {
    const words = mentionKey(name).split(' ');
    return words.length === 2 && PARTICLES.has(words[0]);
};

export const lonePrompt = (name, titles, item) => `A person named in the news: "${name}".

Titles of news naming them:
${titles.map(title => `- ${title}`).join('\n')}

The only item of Wikidata called so: ${item.description || '(no description)'}${item.country ? ` (country: ${item.country})` : ''}, in ${item.links} Wikipedias.

Is the "${name}" of these news this person? "yes" only when the titles fit what the item says (their field,
their role, their country). "no" when they do not fit (another job, another country, another time). "unsure"
when the item or the titles say too little to tell.
Answer in JSON only: {"same": "yes"}`;

// qid when the person ({id, name, lang} of mentions) is this item, the one called so, null else; usage:
// the tokens the AI took, counted in it
export const personItem = async ({id, name}, qid, usage = null) => {
    // asked as the searches of the link loop are, without maxlag: Wikidata lagged more than 5 s 44 times in
    // 3 hours (20.10.2026), the person would wait at the head of the queue meanwhile
    const [item] = await describeItems([qid]);
    if (!item?.human) return null;
    if (!mentionKey(name).includes(' ')) return mentionKey(item.label ?? '') === mentionKey(name) && item.links >= WORD_SITELINKS ? qid : null;
    if (item.links >= PERSON_SITELINKS || (item.links >= 1 && !familyName(name))) return qid;
    const titles = await MentionModel.titlesNaming(id, TITLES);
    if (titles.length === 0) return null;
    const country = (await readCountries([qid])).get(qid)?.country ?? null;
    const answer = await ollamaJson(lonePrompt(name, titles, {...item, country}), usage);
    return answer?.same === 'yes' ? qid : null;
};
