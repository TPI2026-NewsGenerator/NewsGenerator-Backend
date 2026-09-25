//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-ai.js
//  Description: What the AI does for a profile: split it into interests, choose the stories of a
//               briefing and check what each one groups. The answers are checked here, the AI is
//               never trusted with the shape.
//

"use strict"

import {ollamaJson} from './ollama.js';

export const MAX_INTERESTS = 6;
export const MAX_BRIEFING = 10;
const MAX_KEYWORDS_CHARS = 400;
const MAX_SEARCHES_PER_LANGUAGE = 2;

export const LANGUAGE_NAMES = {fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien'};
// the language a text of the AI is written in, for the prompts asking it to write
export const WRITTEN_IN = {fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian'};

// The keywords are written for Filter (commas = alternatives, spaces = all the words), and the rules
// are the ones the benches needed: without them the AI wrote phrases ("chef biographie / chef
// biography"), words that do not name the subject alone ("vaccins" for dog health, which sent a
// general medium to its human health feed) and names of models of years ago. The date is given: without
// it "current" meant the AI's own year, and a UEFA profile got "Euro 2024" two years after it.
const today = () => new Date().toLocaleDateString('fr-CH', {day: 'numeric', month: 'long', year: 'numeric'});

const interestsPrompt = ({text, topics, languages, categories}) => `Nous sommes le ${today()}. Voici le profil d'un lecteur de nouvelles, écrit par lui-même :
"""${text}"""
${topics.length > 0 ? `Thèmes qu'il a cochés : ${topics.join(', ')}.\n` : ''}Il lit les nouvelles en : ${languages.map(language => LANGUAGE_NAMES[language] ?? language).join(', ')}.

Découpe ce profil en 1 à ${MAX_INTERESTS} intérêts distincts. Ce que le lecteur dit ne pas vouloir n'est pas un intérêt : ne le mets nulle part.
Pour chaque intérêt, donne :
- "text" : une phrase qui décrit l'intérêt avec ses mots principaux, comme "Rugby : matchs, résultats, Top 14, Six Nations, transferts de joueurs".
- "weight" : 1 pour un intérêt principal, 0.85 pour un intérêt que le lecteur dit secondaire.
- "keywords" : 8 à 12 alternatives séparées par des virgules, dans les langues qu'il lit. CHAQUE alternative, à elle seule, doit désigner le sujet de cet intérêt : un article qui la contient en parle presque sûrement. Une alternative est un mot, ou 2 ou 3 mots qui doivent tous être dans l'article, séparés par des espaces. Si un mot seul est trop général, ajoute-lui le mot du sujet ("vaccin chien" et pas "vaccins"). Jamais d'article ni de préposition, pas de barre oblique, pas de mot général seul ("actualités", "news", "match", "santé", "interview"). Pour les noms propres (modèles, compétitions, personnes), ne cite que ceux qui sont actuels et certains, jamais l'édition d'une année passée ("Euro 2024") : sans année si tu ne connais pas l'édition en cours.
  Exemple pour "la santé des chats" : "vétérinaire chat, vaccin chat, chat malade, maladie chat, croquettes chat, coryza, typhus félin, cat health, cat vet, feline disease"
- "searches" : ${MAX_SEARCHES_PER_LANGUAGE} recherches courtes (1 à 3 mots) par langue qu'il lit, pour trouver dans Google News les médias qui publient sur ce sujet. Des mots qu'un titre d'article contiendrait, pas des phrases.
- "sections" : 1 mot par langue qu'il lit qui nomme la rubrique d'un journal où ce sujet est publié, comme "rugby", "gastronomie", "animaux", "technologie".
- "category" : la rubrique la plus proche parmi : ${categories.join(', ')}.
Réponds uniquement en JSON : {"interests": [{"text": "...", "weight": 1, "keywords": "...", "searches": [{"q": "...", "lang": "${languages[0]}"}], "sections": ["..."], "category": "${categories[0]}"}]}`;

const cleanText = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

// the answer of the AI made safe: at most MAX_INTERESTS interests with a text, weights between 0.5
// and 1, searches only in the languages read, a category of the list
export const normalizeInterests = (answer, {languages, categories}) => {
    const interests = Array.isArray(answer?.interests) ? answer.interests : [];

    return interests
        .map(interest => {
            const weight = Number(interest?.weight);

            const searches = [];
            const perLanguage = new Map();
            for (const search of Array.isArray(interest?.searches) ? interest.searches : []) {
                const q = cleanText(search?.q, 80);
                const count = (perLanguage.get(search?.lang) ?? 0) + 1;
                if (!q || !languages.includes(search?.lang) || count > MAX_SEARCHES_PER_LANGUAGE) continue;

                perLanguage.set(search.lang, count);
                searches.push(`${search.lang}:${q}`);
            }

            return {
                text: cleanText(interest?.text, 300),
                weight: Number.isFinite(weight) ? Math.min(1, Math.max(0.5, weight)) : 1,
                keywords: cleanText(interest?.keywords, MAX_KEYWORDS_CHARS).replace(/\s*\/\s*/g, ', '),
                searches: searches,
                sections: [...new Set((Array.isArray(interest?.sections) ? interest.sections : [])
                    .map(section => cleanText(section, 40)).filter(Boolean))].slice(0, 4),
                category: categories.includes(interest?.category) ? interest.category : categories[0],
            };
        })
        .filter(interest => interest.text)
        .slice(0, MAX_INTERESTS);
};

// a search kept as "fr:Top 14", read back as {lang, q}
export const parseSearch = (search) => {
    const [, lang, q] = String(search).match(/^([a-z]{2}):(.+)$/) ?? [];
    return lang ? {lang, q} : null;
};

export const interestsOf = async (profile) => normalizeInterests(await ollamaJson(interestsPrompt(profile)), profile);

// What the reader said of cards before, as examples: they say what the profile text does not ("no
// predictions", "more refereeing"). Only what makes them alike is refused, the prompt says so: one
// refused card on a match must not remove every match. Nothing when the reader gave no thumb, the
// prompt is then the one measured on the benches
const feedbackBlock = ({liked = [], refused = []} = {}) => (liked.length === 0 && refused.length === 0 ? '' : `
Ce lecteur a déjà jugé des histoires des jours passés. Sers-t'en pour comprendre ce qu'il veut vraiment, en plus de son profil :
${liked.length > 0 ? `il les a trouvées bonnes pour lui :\n${liked.map(title => `+ ${title}`).join('\n')}\n` : ''}${refused.length > 0 ? `il ne les voulait pas :\n${refused.map(title => `- ${title}`).join('\n')}\n` : ''}Cherche ce qui les rapproche (un genre d'article, un angle, un sujet précis) plutôt que de refuser tout ce qui parle des mêmes équipes ou des mêmes personnes.
`);

// a story told by a source the reader trusts (their choice, see FeedModel.setTrusted); nothing is
// added to the prompt when no candidate has one
const TRUSTED_MARK = '(source de confiance du lecteur)';

// The prompt measured on the four profiles of the bench: 95% then 96% of relevant cards, and it
// answers fewer than ten stories when fewer fit (0 for the chef with the feeds of the start only).
// The user's refusals are left to it: as vectors they removed good stories as well as bad ones.
export const selectionPrompt = (profileText, candidates, examples = {liked: [], refused: []}) => `Voici le profil d'un lecteur, écrit par lui-même :
"""${profileText}"""
${feedbackBlock(examples)}
Voici des histoires d'actualité du jour, chacune avec son identifiant entre crochets :
${candidates.map(c => `[${c.id}] ${c.title}${c.description ? ` — ${c.description}` : ''}${c.others.length > 0 ? ` (aussi : ${c.others.join(' / ')})` : ''}${c.trusted ? ` ${TRUSTED_MARK}` : ''}`).join('\n')}
${candidates.some(c => c.trusted) ? `\nLes histoires marquées ${TRUSTED_MARK} sont racontées par une source que ce lecteur a choisie et en qui il a confiance : à pertinence égale, préfère-les. Ne choisis jamais une histoire hors de ses intérêts pour cette seule raison.\n` : ''}
Choisis au plus ${MAX_BRIEFING} histoires qui correspondent vraiment à ce que ce lecteur demande, de la plus à la moins pertinente.
Respecte aussi ce qu'il dit ne pas vouloir. S'il y en a moins de ${MAX_BRIEFING} qui conviennent, n'en rends que celles-là : une liste courte vaut mieux qu'une histoire hors sujet.
Ne choisis jamais deux histoires qui racontent la même nouvelle (le même match ou la même annonce dans deux langues ou par deux médias) : garde la meilleure.
Varie les sujets : pas deux histoires sur la même équipe, la même personne ou le même match à venir, sauf si ce sont deux nouvelles importantes et différentes.
Préfère les nouvelles (faits, décisions, résultats, déclarations) aux pronostics, conseils de paris et guides, sauf si le lecteur les demande.
Ne choisis jamais ce qui n'apporte aucun fait du jour : page de dossier ou de thème qui explique un sujet en général, guide pratique ("comment regarder…", "à quelle heure…"), compilation de vidéos ou de plus beaux buts.
Pour chacune, "why" est une phrase courte qui dit au lecteur pourquoi elle est pour lui, dans la langue de son profil, tirée seulement de ce que disent son titre et sa description : si le lien avec le profil n'y est pas, ne la choisis pas.
Réponds uniquement en JSON : {"selected": [{"id": "...", "why": "une phrase courte"}]}`;

// the stories chosen, only among the ones given, each once, at most MAX_BRIEFING
export const normalizeSelection = (answer, knownIds) => {
    const known = new Set(knownIds.map(String));
    const selected = new Map();

    for (const item of Array.isArray(answer?.selected) ? answer.selected : []) {
        // "[42]" is sometimes answered for 42
        const id = String(item?.id ?? '').replace(/^\[|\]$/g, '');
        if (known.has(id) && !selected.has(id)) selected.set(id, {id, why: cleanText(item?.why, 300)});
    }

    return [...selected.values()].slice(0, MAX_BRIEFING);
};

// candidates: [{id, title, description, others: [titles]}]
// examples: {liked: [titles], refused: [titles]}, the thumbs of the reader (see utils/feedback.js)
export const selectStories = async (profileText, candidates, usage = null, examples = undefined) =>
    normalizeSelection(await ollamaJson(selectionPrompt(profileText, candidates, examples), usage), candidates.map(c => c.id));

// The stories are grouped by vectors, and two media writing on one subject can land in one story
// without telling the same fact (a product launch and a bug found in it). No threshold of the vectors
// separates them cleanly, so the AI reads the few stories of a briefing before they are shown, all in
// one call: which articles tell the news of the lead one. The card counts and lists only those.
// Measured on 30 cards read by hand (the biggest stories, stories taken at random, and stories still
// mixing two facts): gemma4:31b keeps 92% of the articles of the same news and drops 91% of the
// others. Without "keep the analyses, when in doubt keep it" it dropped a quarter of the good ones.
// About 1000 to 6500 tokens read and 400 written for ten cards, 2 seconds.
export const checkPrompt = (stories) => `Voici des histoires d'actualité, chacune avec son identifiant entre crochets. Chaque histoire a un
article principal (P) et d'autres articles, numérotés, regroupés automatiquement avec lui.

Pour chaque histoire, dis quels articles numérotés parlent de LA MÊME NOUVELLE que l'article principal :
le même événement précis (la même annonce, décision, rencontre, match, incident, déclaration, publication),
même avec d'autres mots ou sous un autre angle.
Un article d'analyse, d'opinion, d'explication, de réactions, de chiffres ou de conséquences sur ce même
événement en fait partie : garde-le. Dans le doute, si l'article parle de ce même événement, garde-le.
N'enlève que les articles dont l'événement principal est un AUTRE, même sur le même sujet, les mêmes
personnes ou la même entreprise : un lancement de produit et un bug trouvé ensuite, deux matchs, les
prévisions de deux pays, un discours et une autre décision du même dirigeant, un match et une autre
affaire du même joueur, une explication de fond et un incident précis sur le même sujet, l'enjeu d'un
match et les déclarations ou la revue de presse d'avant-match de la même équipe.

${stories.map(story => `[${story.id}]
P. ${story.lead.title}${story.lead.description ? ` — ${story.lead.description}` : ''}
${story.others.map((other, i) => `${i + 1}. ${other.title}${other.description ? ` — ${other.description}` : ''}`).join('\n')}`).join('\n\n')}

Réponds uniquement en JSON : {"stories": [{"id": "...", "same": [numéros des articles qui racontent la même nouvelle que P]}]}`;

// for each story answered, the numbers (from 1) of its articles telling the news of the lead one:
// Map id -> Set. A story the AI did not answer is left out, it is shown as the vectors grouped it
export const normalizeCheck = (answer, stories) => {
    const sizes = new Map(stories.map(story => [String(story.id), story.others.length]));
    const checked = new Map();

    for (const item of Array.isArray(answer?.stories) ? answer.stories : []) {
        const id = String(item?.id ?? '').replace(/^\[|\]$/g, '');
        if (!sizes.has(id) || checked.has(id)) continue;
        const same = (Array.isArray(item?.same) ? item.same : [])
            .map(Number)
            .filter(n => Number.isInteger(n) && n >= 1 && n <= sizes.get(id));
        checked.set(id, new Set(same));
    }

    return checked;
};

// stories: [{id, lead: {title, description}, others: [{title, description}]}]
export const checkStories = async (stories, usage = null, {think} = {}) =>
    stories.length === 0 ? new Map() : normalizeCheck(await ollamaJson(checkPrompt(stories), usage, {think}), stories);

// The choice can take two stories of one news: the verdict of Manchester City and "the sanctions City
// risks" were two cards. Asked in the call of the check, this question made it drop 72% of the
// articles of another news instead of 96% (bench of the check): it is a call of its own, sent with
// the check, on the lead article of each card only. The later card joins the first one.
// shown: the cards of the last days, at the top of the same list (one news is often several stories,
// a French one and an English one), and answered like the others: about 20 tokens written per card.
// Measured on the evening briefings, both cheaper ways made mistakes the full list does not: the shown
// cards apart under their own heading, or answering for the stories of the day only, took an
// explanation for the decision it explains, or a goals video for a refereeing talk of the same round
const storyLine = (story) => `[${story.id}] ${story.lead.title}${story.lead.description ? ` — ${story.lead.description}` : ''}`;

export const mergePrompt = (stories, shown = []) => `Voici les histoires d'un résumé de l'actualité, dans l'ordre, chacune avec son identifiant entre crochets.

Pour chaque histoire, dis si elle raconte le MÊME FAIT qu'une histoire PLUS HAUT dans la liste : la même
annonce, décision, incident, verdict ou publication, même sous un autre angle (réactions, analyse,
conséquences, chronologie, sanctions possibles de ce même verdict).
Ne sont PAS le même fait, même sur le même sujet, le même match, les mêmes personnes ou la même équipe :
deux matchs ; l'avant-match (enjeu, composition, revue de presse) et un autre fait autour du même match ;
un guide pour regarder un match et un fait du match ; une blessure et le match où elle a eu lieu ; une
explication générale ou historique et une décision ou un incident précis ; la couverture d'un événement
par un média et l'événement lui-même ; l'avis, l'interview ou l'hommage de quelqu'un à l'occasion d'un
événement et cet événement.
Dans le doute, ce n'est pas le même fait : réponds null. Fusionner à tort cache une nouvelle au lecteur.

${[...shown, ...stories].map(storyLine).join('\n')}

Réponds uniquement en JSON : {"stories": [{"id": "...", "sameAs": "identifiant d'une histoire plus haut" ou null}]}`;

// the stories telling the news of a story above them: Map id -> id of the first story of that news
// (a shown card is above them all). Only a story higher in the list counts (no cycle), a chain leads
// to its first story, and only the stories of the day are answered
export const normalizeMerges = (answer, stories, shown = []) => {
    const rank = new Map([...shown.map((card, i) => [String(card.id), i - shown.length]),
        ...stories.map((story, i) => [String(story.id), i])]);
    const today = new Set(stories.map(story => String(story.id)));
    const clean = (id) => String(id ?? '').replace(/^\[|\]$/g, '');
    const target = new Map();

    for (const item of Array.isArray(answer?.stories) ? answer.stories : []) {
        const id = clean(item?.id);
        const into = clean(item?.sameAs);
        if (today.has(id) && rank.has(into) && rank.get(into) < rank.get(id) && !target.has(id)) target.set(id, into);
    }

    const first = (id) => (target.has(id) ? first(target.get(id)) : id);
    return new Map([...target.keys()].map(id => [id, first(id)]));
};

// stories and shown: [{id, lead: {title, description}}], in the order shown
export const mergeStories = async (stories, shown = [], usage = null) =>
    stories.length + shown.length < 2 || stories.length === 0 ? new Map()
        : normalizeMerges(await ollamaJson(mergePrompt(stories, shown), usage), stories, shown);
