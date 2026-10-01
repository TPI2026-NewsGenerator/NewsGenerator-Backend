//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: search-ai.js
//  Description: A search written as a sentence: the AI reads the news closest to it in meaning and
//               says which ones answer it, and which ones are only close to it
//

"use strict"

import {ollamaJson} from './ollama.js';

const DESCRIPTION_CHARS = 160;      // the start of the description read with the title

// Measured on 13 sentences in French and English (bench/meaning.mjs, meaning-ai.mjs): the vectors
// alone rank a broad subject well but not a sentence that names someone, a place or an aspect ("AI
// at the hospital" gave AI in general), nor one that excludes something, and their scores do not
// say where the answers stop (the first news of a sentence with no answer scored like the tenth of
// another). So they only bring the candidates, the AI judges them. Asked for one list, it left out
// news a reader would want (fuel prices for "the rise of energy prices"): the ones not answering the
// whole sentence go in a second list, shown after the answers. Told that "short or empty lists are
// better than a news off the subject", it still left out of that list news on the very subject (the
// model releases for "the latest AI models for programming", the rest of a visit for "what the pope
// said during his visit"): without it, on 14 sentences asked 4 times (bench/meaning-variants.mjs),
// those came back and nothing off the subject came in, only a sentence excluding something lost a
// few answers. Counting "the same subject without the precision of the sentence" as close brought
// AI in general for "AI at the hospital". A word of the sentence inside a name took the place of its
// meaning: "les prix de l'immobilier en Suisse" answered "remise des Prix de l'immobilier romand", an
// awards evening, first, 5 times in 5 on the candidates with Google News, and kept the rents of
// Switzerland as close only. Told that the words count for their meaning, not their form, the AI
// still did; told that a word only in a name does not count either, it left the evening out 5 times
// in 5 and answered the rents, with no change on the 14 other sentences (bench/meaning-sense.mjs).
export const searchPrompt = (query, candidates) => `Un lecteur cherche des nouvelles avec cette phrase : """${query}"""

Voici des articles, chacun avec son identifiant entre crochets :
${candidates.map(c => `[${c.id}] ${c.title}${c.description ? ` — ${c.description}` : ''}`).join('\n')}

Classe les articles qui concernent sa recherche en deux listes, chacune du plus au moins pertinent :
- "answers" : ceux qui répondent à sa phrase, même avec d'autres mots (un synonyme, une partie ou un cas particulier du sujet répondent aussi). Quand sa phrase précise quelque chose (une personne, une organisation, un lieu, une période, un aspect), l'article en parle.
- "related" : ceux qui parlent directement du même sujet sans répondre à toute sa phrase (une autre précision, un autre lieu, un autre aspect).
Les autres articles, qui touchent seulement le même domaine, ne sont dans aucune liste. Les mots de sa phrase comptent pour leur sens, pas pour leur forme : un article qui les emploie dans un autre sens, ou seulement dans un nom (d'une récompense, d'un événement, d'une œuvre, d'une organisation), ne la concerne pas. Ce que sa phrase exclut n'est dans aucune liste, même quand l'article touche le sujet.
Juge seulement sur le titre et la description.
Réponds uniquement en JSON : {"answers": ["identifiant", ...], "related": ["identifiant", ...]}`;

// the ids of the answers and of the news close to them, only among the ones given, each once
export const normalizeSorting = (answer, knownIds) => {
    const known = new Set(knownIds.map(String));
    const seen = new Set();
    const pick = (ids) => (Array.isArray(ids) ? ids : [])
        // "[42]" is sometimes answered for 42
        .map(id => String(id ?? '').replace(/^\[|\]$/g, ''))
        .filter(id => known.has(id) && !seen.has(id) && seen.add(id));

    const answers = pick(answer?.answers);
    return {answers, related: pick(answer?.related)};
};

// candidates: [{id, title, description}] -> {answers: [id], related: [id]}. Asked once more when the
// AI does not answer in JSON (1 search in 13 of the bench)
export const sortByMeaning = async (query, candidates, usage = null) => {
    const prompt = searchPrompt(query, candidates.map(({id, title, description}) => ({
        id,
        title,
        description: (description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS),
    })));
    const answer = await ollamaJson(prompt, usage).catch(() => ollamaJson(prompt, usage));
    return normalizeSorting(answer, candidates.map(c => c.id));
};
