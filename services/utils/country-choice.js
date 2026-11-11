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
import {countryName, countryOfSite} from './country-names.js';
import {MAX_COUNTRIES} from './countries.js';

// the candidates shown at most for a card, the heaviest first, and the sentences of the card given with its titles
export const MAX_CANDIDATES = 6;
const TEXT_CHARS = 350;
const TITLES = 3;

// The candidate countries of a card: items [{qid, weight, person}] (who and where it names), of: Map qid -> {country,
// international, bodies, media} (see readCountries), labels: Map qid -> the name as the card writes it. Answers
// [{code, weight, via: [{name, person, media, international}]}], the heaviest first. The people of an international body the card names
// are not offered: they are not of their country (see cardCountries of countries.js, measured on 19.10.2026: 79 right of 84), and the
// AI kept the country of the president of the UEFA, as the subject of the title the prompt tells to keep, in 2 runs of 5 on a conflict of
// the UEFA with the FIFA (8.11.2026) when none of the 67 such candidates of the last 60 briefings had been kept
export const countryCandidates = (items, of, labels = new Map()) => {
    const weights = new Map();
    for (const {qid, weight, person} of items) {
        if (qid) weights.set(qid, {weight: Math.max(weights.get(qid)?.weight ?? 0, weight), person: Boolean(person)});
    }
    const international = new Set([...weights.keys()].filter(qid => of.get(qid)?.international));
    const byCode = new Map();
    for (const [qid, {weight, person}] of weights) {
        const info = of.get(qid);
        if (!info?.country || (person && (info.bodies ?? []).some(body => international.has(body)))) continue;
        const entry = byCode.get(info.country) ?? {code: info.country, weight: 0, via: []};
        entry.weight += weight;
        entry.via.push({name: labels.get(qid) ?? qid, person, media: Boolean(info.media), international: Boolean(info.international)});
        byCode.set(info.country, entry);
    }
    return [...byCode.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_CANDIDATES);
};

// what a candidate says of where it comes from: "Burleanu (personne)"
const viaText = ({name, person, media, international}) => {
    const kind = media ? 'média' : international ? 'organisation internationale, son siège' : person ? 'personne' : null;
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

// ---- the cards no evidence gives a country to (a friend of the user, 10.11.2026: an article in Vietnamese on the National Games of Vietnam, a
// federation of Kenya named in full, and no country)

// The sites of a card are of a country when most of them are, by their domain ("prosport.ro"): a card told by the press of one country is more
// often a news of it than of the world. Answers the code or null. sites: the hosts of its articles
export const SITES_SHARE = 0.5;
export const countryOfSites = (sites = []) => {
    const hosts = [...new Set(sites.filter(Boolean))];
    const byCountry = new Map();
    for (const host of hosts) {
        const code = countryOfSite(host);
        if (code) byCountry.set(code, (byCountry.get(code) ?? 0) + 1);
    }
    const [top] = [...byCountry].sort((a, b) => b[1] - a[1]);
    return top && top[1] >= SITES_SHARE * hosts.length ? top[0] : null;
};

// The weak candidates of a card that has none: the country of a person its family name alone is linked to (items: [{qid, weight, person, name}], of,
// see countryCandidates: the family name of a person named in full by fewer news than SURNAME_COUNTRY_SEEN of card-names.js), then the country of
// most of its sites. [{code, kind: 'surname' | 'sites', name?, sites?}], at most MAX_COUNTRIES
export const weakCandidates = (items, of, sites = []) => {
    const labels = new Map(items.map(item => [item.qid, item.name]));
    const found = countryCandidates(items, of, labels).map(candidate => ({code: candidate.code, kind: 'surname', name: candidate.via[0].name}));
    const site = countryOfSites(sites);
    if (site && !found.some(candidate => candidate.code === site)) found.push({code: site, kind: 'sites', sites: [...new Set(sites.filter(Boolean))].length});
    return found.slice(0, MAX_COUNTRIES);
};

const weakText = (candidate) => candidate.kind === 'surname'
    ? `${candidate.code} ${countryName(candidate.code, 'fr')}: « ${candidate.name} » (nom de famille seul, d'une personne connue de ce pays, incertain)`
    : `${candidate.code} ${countryName(candidate.code, 'fr')}: les sites qui racontent l'actualité sont de ce pays`;

// cards: [{titles, text, candidates}] (candidates from weakCandidates, at least one)
export const weakPrompt = (cards) => `Voici des actualités pour lesquelles aucun pays n'a été trouvé de façon sûre. Pour chacune : ses titres, un extrait, et un pays soupçonné d'après un indice faible.

Garde un pays seulement si l'actualité PARLE de ce pays : elle s'y passe, ou ses acteurs principaux en sont (leur équipe, leur fédération, leur institution, leur gouvernement), et si le texte ou les titres le montrent.
- Indice « nom de famille seul » : à garder seulement si le texte nomme la personne en entier ou dit son pays ; un homonyme d'un autre pays n'est pas ce pays.
- Indice « sites de ce pays » : le pays des sites qui racontent l'actualité ne suffit pas. Une actualité sur le football mondial, sur une organisation internationale (FIFA, UEFA, CAF), sur un autre pays ou sur un sujet général (l'arbitrage vidéo, les paris), racontée par des sites de ce pays, n'est pas de ce pays. Garde le pays si le texte nomme un lieu, une compétition, une fédération, un club ou une personne de ce pays.
Dans le doute, ne garde pas : un pays faux est pire qu'aucun. Tu ne peux choisir que parmi les candidats, par leur code.

${cards.map((card, i) => `[${i + 1}] ${card.titles.slice(0, TITLES).join(' | ')}
${String(card.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS)}
Candidats : ${card.candidates.map(weakText).join(' ; ')}`).join('\n\n')}

Réponds uniquement en JSON : {"cards": [{"n": numéro, "countries": ["code"]}]}`;

// the cards given (each with at least one weak candidate): Map index -> [code]. Rejects when the AI fails
export const chooseWeakCountries = async (cards, usage = null) =>
    cards.length === 0 ? new Map() : normalizeChoice(await ollamaJson(weakPrompt(cards), usage), cards);

// ---- the countries a card shows, read again by an AI that sees no candidate (11.11.2026)
// The countries of a card come from the names it holds (Wikidata) and the AI only chooses among them, so a namesake, a person of an international body, a list of
// leagues or an expatriate gives a country the news is not about. Measured on 120 cards of the last briefings against two blind judges (bench/countries/measure.mjs):
// the product showed 105 countries, 76% right, 20% wrong, a wrong country on 13% of the cards; an AI that reads the card and names the countries itself, with no
// candidate and no knowledge of the product's answer, is right on 74% but finds 96% of what the judges name; the countries both give, 90% right, a wrong one on 5% of
// the cards, 74% found (the cards left with none go from 17 to 19 of the 120). "A wrong country is worse than none" (03.11.2026): the countries the product shows are
// kept when the AI names them too
export const READING_DEFINITION = `For each card, give the countries the news is ABOUT, as ISO 3166-1 alpha-2 codes (GB for the United Kingdom and for England, Scotland, Wales and Northern Ireland), the main one first, three at most.
A country is kept when the news takes place there, or when its main actors are of it and speak or act for it: their team, their government, their institution, their company.
Do NOT keep: the country of the medium that reports the news; the seat of an international body when the news is not about that country (FIFA and Switzerland, UN and the United States); the country of a person who is only named in passing; the country of a namesake; the country of a person who runs for or sits in an international body, unless the news is about their country.
A news may have NO country (an empty list). In doubt, keep none: a wrong country is worse than none.`;
export const READ_CHARS = 450;
export const READ_BATCH = 15;
const READ_TIMEOUT_MS = 120e3;

// cards: [{titles, text}]
export const readingPrompt = (cards) => `${READING_DEFINITION}

${cards.map((card, i) => `[${i + 1}] ${card.titles.slice(0, TITLES).join(' | ')}
    ${String(card.text ?? '').replace(/\s+/g, ' ').trim().slice(0, READ_CHARS)}`).join('\n\n')}

Answer only in JSON: {"cards": [{"n": number, "countries": ["FR"]}]}`;

// the codes the AI gave for each card it answered: Map index (from 0) -> [code], any country (it is not given candidates); a card it left out has no entry
export const normalizeReading = (answer, count) => {
    const read = new Map();
    for (const item of Array.isArray(answer?.cards) ? answer.cards : []) {
        const index = Number(String(item?.n ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || read.has(index) || !Array.isArray(item?.countries)) continue;
        read.set(index, [...new Set(item.countries.map(code => String(code ?? '').trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)))]);
    }
    return read;
};

// the cards given ({titles, text}): Map index -> [code], READ_BATCH cards a call. A batch the AI fails is left out (its cards have no entry) and the others are kept;
// rejects when the AI failed on every batch
export const readCountries = async (cards, usage = null) => {
    const read = new Map();
    let failure = null, answered = 0;
    for (let from = 0; from < cards.length; from += READ_BATCH) {
        const batch = cards.slice(from, from + READ_BATCH);
        try {
            for (const [at, codes] of normalizeReading(await ollamaJson(readingPrompt(batch), usage, {timeoutMs: READ_TIMEOUT_MS}), batch.length)) read.set(from + at, codes);
            answered++;
        } catch (err) {
            failure = err;
        }
    }
    if (answered === 0 && failure) throw failure;
    return read;
};

// the countries shown that the AI reading the card names too, in the order shown; all of them when it did not answer that card (read: its codes, or undefined)
export const agreedCountries = (shown, read) => read === undefined ? shown : shown.filter(code => read.includes(code));

// ---- a card that names an international body shows its main country only (11.11.2026)
// After the reading the countries shown were 92% right for the first one, 40% for the second and 50% for the third: 7 of the 10 wrong countries of the 120 cards were
// secondary ones, and almost all on the cards of the politics of the FIFA (the hosts of the World Cup 2030 beside the country of a stadium, the countries that support
// Infantino, the nationality of a referee), where the AI reading the card agrees with the product on the wrong country (three readings did). On the 5 cards of the sample
// that name a body and show several countries, keeping the first only took 6 wrong countries off and 2 right ones (the country of a referee a body delegated); the
// precision went from 85% to 91% and the countries found from 75% to 73%. Set on the errors of that sample: to be checked on cards it has not seen (bench/countries).
// 'international': whether the card names an item Wikidata flags as an international body (FIFA, UEFA, CAF, AFC, CONMEBOL, the IOC...), see readCountries of wikidata.js
export const countriesShown = (countries, {international = false} = {}) => international ? countries.slice(0, 1) : countries;
