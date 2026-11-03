//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: country-choice.js
//  Description: The countries of a card chosen by the AI among the ones Wikidata found for who and where it names (the
//               user, 03.11.2026: a wrong country looks unprofessional, none is better). Wikidata gives the candidates
//               and the AI says which the news is about: the medium that tells it, the seat of an international body, a
//               person named in passing and a namesake of another country are candidates that are not what the news is
//               about, and rules found one by one (countries.js) leave others. The AI cannot name a country that is not a
//               candidate. When it fails, the rules of countries.js apply
//

"use strict"

import {ollamaJson} from './ollama.js';
import {countryName} from './country-names.js';
import {MAX_COUNTRIES} from './countries.js';

// the candidates shown at most for a card, the heaviest first, and the sentences of the card given with its titles
export const MAX_CANDIDATES = 6;
const TEXT_CHARS = 350;
const TITLES = 3;

// The candidate countries of a card: items [{qid, weight, person}] (who and where it names), of: Map qid -> {country,
// international, bodies, media} (see readCountries), labels: Map qid -> the name as the card writes it. Answers
// [{code, weight, via: [{name, person, media, international, ofBody}]}], the heaviest first
export const countryCandidates = (items, of, labels = new Map()) => {
    const weights = new Map();
    for (const {qid, weight, person} of items) {
        if (qid) weights.set(qid, {weight: Math.max(weights.get(qid)?.weight ?? 0, weight), person: Boolean(person)});
    }
    const international = new Set([...weights.keys()].filter(qid => of.get(qid)?.international));
    const byCode = new Map();
    for (const [qid, {weight, person}] of weights) {
        const info = of.get(qid);
        if (!info?.country) continue;
        const entry = byCode.get(info.country) ?? {code: info.country, weight: 0, via: []};
        entry.weight += weight;
        entry.via.push({name: labels.get(qid) ?? qid, person, media: Boolean(info.media), international: Boolean(info.international),
            ofBody: person && (info.bodies ?? []).some(body => international.has(body))});
        byCode.set(info.country, entry);
    }
    return [...byCode.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_CANDIDATES);
};

// what a candidate says of where it comes from: "Infantino (person of an international body)"
const viaText = ({name, person, media, international, ofBody}) => {
    const kind = media ? 'média' : international ? 'organisation internationale, son siège' : ofBody ? "personne d'un organisme international" : person ? 'personne' : null;
    return kind ? `${name} (${kind})` : name;
};
const candidateText = (candidate) => `${candidate.code} ${countryName(candidate.code, 'fr')}: ${candidate.via.slice(0, 3).map(viaText).join(', ')}`;

// cards: [{titles, text, candidates}] (candidates from countryCandidates, at least one)
export const countryPrompt = (cards) => `Voici des actualités. Pour chacune : ses titres, un extrait, et les pays candidats trouvés grâce aux personnes, lieux et organisations qu'elle nomme (ce qui l'a fait trouver est entre parenthèses).

Pour chaque actualité, garde les pays DONT PARLE l'actualité : où elle se passe, ou dont les acteurs principaux sont (leur équipe, leur gouvernement, leur institution). Le pays de la personne, de l'équipe ou de l'institution qui est le sujet du titre est à garder.
Ne garde pas : le pays du média qui rapporte la nouvelle (« L'Équipe : … », « selon Reuters »), le siège d'une organisation internationale quand la nouvelle n'est pas sur ce pays (la FIFA et la Suisse, l'ONU et les États-Unis), le pays d'une personne citée en passant, ni un homonyme (une personne ou un lieu d'un autre pays que celui de l'actualité).
Une actualité peut n'avoir aucun pays : liste vide. Dans le doute, ne garde pas. ${MAX_COUNTRIES} pays au plus, le principal d'abord. Tu ne peux choisir que parmi les candidats, par leur code.

${cards.map((card, i) => `[${i + 1}] ${card.titles.slice(0, TITLES).join(' | ')}
${String(card.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS)}
Candidats : ${card.candidates.map(candidateText).join(' ; ')}`).join('\n\n')}

Réponds uniquement en JSON : {"cards": [{"n": numéro, "countries": ["code"]}]}`;

// for each card answered, the codes it keeps: Map index (from 0) -> [code], the candidates only, MAX_COUNTRIES at most, in the order the
// AI gave. A card the AI did not answer is left out (the rules of countries.js decide it); one answered with none has none
export const normalizeChoice = (answer, cards) => {
    const chosen = new Map();
    for (const item of Array.isArray(answer?.cards) ? answer.cards : []) {
        const index = Number(String(item?.n ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= cards.length || chosen.has(index) || !Array.isArray(item?.countries)) continue;
        const offered = new Set(cards[index].candidates.map(candidate => candidate.code));
        chosen.set(index, [...new Set(item.countries.map(code => String(code ?? '').trim().toUpperCase()).filter(code => offered.has(code)))].slice(0, MAX_COUNTRIES));
    }
    return chosen;
};

// the cards given (each with at least one candidate): Map index -> [code]. Rejects when the AI fails
export const chooseCountries = async (cards, usage = null) =>
    cards.length === 0 ? new Map() : normalizeChoice(await ollamaJson(countryPrompt(cards), usage), cards);
