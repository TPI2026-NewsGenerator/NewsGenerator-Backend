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
// the stories the AI may choose: more than a briefing shows, so that each interest can have its share
// of it (see balanceSelection)
export const MAX_CHOSEN = MAX_BRIEFING + 5;
const MAX_KEYWORDS_CHARS = 400;
const MAX_SEARCHES_PER_LANGUAGE = 2;

export const LANGUAGE_NAMES = {fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien'};
// the language a text of the AI is written in, for the prompts asking it to write
export {WRITTEN_IN} from './language.js';

// The keywords are written for Filter (commas = alternatives, spaces = all the words), and the rules
// are the ones the benches needed: without them the AI wrote phrases ("chef biographie / chef
// biography"), words that do not name the subject alone ("vaccins" for dog health, which sent a
// general medium to its human health feed) and names of models of years ago. The date is given: without
// it "current" meant the AI's own year, and a UEFA profile got "Euro 2024" two years after it.
// The rules hold for any subject, and their examples are taken on none of the profiles measured
// (football, tennis, AI, Swiss politics, motor racing, climate, Japanese food, dogs, hiking): a
// prompt fitted to the profiles it is measured on would say nothing of the others. Measured 3 times on
// the 7 profiles: no word left out, the UEFA one in 3 interests each time; a profile of keywords only
// ("F1, MotoGP, Verstappen, Ducati, règlement technique 2027, transferts de pilotes…") still gets an
// interest whose subject is unsure ("Marché des pilotes") 2 times of 3: it does not say it either.
// A rule sending each precision to the interest it precises merged the UEFA competitions and their
// governance 6 times of 6, it only takes the precisions that name no subject
const today = () => new Date().toLocaleDateString('fr-CH', {day: 'numeric', month: 'long', year: 'numeric'});

export const interestsPrompt = ({text, topics, languages, categories}) => `Nous sommes le ${today()}. Voici le profil d'un lecteur de nouvelles, écrit par lui-même :
"""${text}"""
${topics.length > 0 ? `Thèmes qu'il a cochés : ${topics.join(', ')}.\n` : ''}Il lit les nouvelles en : ${languages.map(language => LANGUAGE_NAMES[language] ?? language).join(', ')}.

Découpe ce profil en 1 à ${MAX_INTERESTS} intérêts distincts. Ce que le lecteur dit ne pas vouloir n'est pas un intérêt : ne le mets dans aucun intérêt, mets-le dans "refused".
Pour chaque intérêt, donne :
- "text" : le sujet de l'intérêt, puis TOUT ce que le lecteur en cite, avec ses propres mots et sans en résumer ni en enlever aucun, comme "Opéra : nouvelles productions de l'Opéra de Paris et de la Scala, nominations des directeurs et des chefs d'orchestre". Chaque précision du lecteur compte et reste telle quelle : "les expositions et les ventes aux enchères d'art contemporain" ne devient pas "art contemporain". Le texte se lit seul : il nomme toujours son sujet ("les nouvelles lignes de TGV", pas "les nouvelles lignes"). Une précision qui ne nomme aucun sujet ("des règles", "des prix") va dans l'intérêt du sujet qu'elle précise, dans chacun s'il y en a plusieurs : elle ne fait jamais un intérêt à elle seule. Il laisse de côté les mots qui disent combien le lecteur l'aime ("j'adore", "un peu"). N'ajoute ni date, ni année, ni nom qu'il n'a pas écrit.
- "weight" : 1 pour un intérêt principal, 0.85 pour un intérêt que le lecteur dit secondaire.
- "keywords" : 8 à 12 alternatives séparées par des virgules, dans les langues qu'il lit. CHAQUE alternative, à elle seule, doit désigner le sujet de cet intérêt : un article qui la contient en parle presque sûrement. Une alternative est un mot, ou 2 ou 3 mots qui doivent tous être dans l'article, séparés par des espaces. Si un mot seul est trop général, ajoute-lui le mot du sujet ("taille rosier" et pas "taille"). Jamais d'article ni de préposition, pas de barre oblique, pas de mot général seul ("actualités", "news", "nouveauté", "interview"). Pour les noms propres (produits, événements, personnes), ne cite que ceux qui sont actuels et certains, jamais l'édition d'une année passée : sans année si tu ne connais pas l'édition en cours.
  Exemple pour "le jardinage bio" : "potager bio, compost jardin, permaculture, semis tomate, purin ortie, paillage potager, jardin sans pesticide, organic gardening, vegetable garden, composting"
- "searches" : ${MAX_SEARCHES_PER_LANGUAGE} recherches courtes (1 à 3 mots) par langue qu'il lit, pour trouver dans Google News les médias qui publient sur ce sujet. Des mots qu'un titre d'article contiendrait, pas des phrases.
- "sections" : 1 mot par langue qu'il lit qui nomme la rubrique d'un journal où ce sujet est publié, comme "jardin", "musique", "transports", "technologie".
- "category" : la rubrique la plus proche parmi : ${categories.join(', ')}.
Dans "refused", mets ce que le lecteur dit ne pas vouloir, avec ses mots, et [] s'il ne refuse rien.
Réponds uniquement en JSON : {"interests": [{"text": "...", "weight": 1, "keywords": "...", "searches": [{"q": "...", "lang": "${languages[0]}"}], "sections": ["..."], "category": "${categories[0]}"}], "refused": ["..."]}`;

const cleanText = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

// A name with a year gone by is an old edition: "Euro 2024" came back once the example was taken out
// of the prompt (a UEFA profile, in 2026). The rule is kept in the prompt, and checked here
const pastYear = (text, year = new Date().getFullYear()) =>
    (String(text).match(/\b(19|20)\d{2}\b/g) ?? []).some(found => Number(found) < year);
const withoutPastYears = (keywords) => keywords.split(',').map(keyword => keyword.trim())
    .filter(keyword => keyword && !pastYear(keyword)).join(', ');

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
                if (!q || pastYear(q) || !languages.includes(search?.lang) || count > MAX_SEARCHES_PER_LANGUAGE) continue;

                perLanguage.set(search.lang, count);
                searches.push(`${search.lang}:${q}`);
            }

            return {
                text: cleanText(interest?.text, 300),
                weight: Number.isFinite(weight) ? Math.min(1, Math.max(0.5, weight)) : 1,
                keywords: withoutPastYears(cleanText(interest?.keywords, MAX_KEYWORDS_CHARS).replace(/\s*\/\s*/g, ', ')),
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

// Words of a profile that say how it is written, not what it is about: they are never looked for in
// the interests
const PROFILE_WORDS = new Set(`
    intéresse intéressent intéresser intérêt intérêts surtout aussi tout toute tous toutes touche touchent
    près enfin veux voudrais aime aimerais adore suivre suis rien mais plus moins très beaucoup peu
    actualité actualités nouvelles nouvelle info infos information informations sujet sujets thème thèmes
    cela ceux celles celle celui leurs notamment comme entre avec dans pour sans sont être avoir fait faire
    également particulier particulièrement principalement ainsi autre autres chose choses quand même lire
    savoir juste seulement vraiment souvent toujours jamais aucun aucune quoi chaque dont vers chez depuis
    sinon accessoirement secondairement parfois éventuellement adore préfère préfèrent passionne passionné
    about also especially mostly really like love latest things stuff everything anything nothing
    that this these those which from their they have more less very much want interested follow news
    with what when where into only just some other others`.trim().split(/\s+/));

const folded = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// The words of the profile no interest names and that are not among what the reader refuses: a
// word is named when an interest has its start ("arbitres" in "arbitrage", "nominations" in
// "nomination"). The AI shortens: "nominations et sanctions des arbitres, changements des règles
// du jeu" of the UEFA profile became "règles du jeu", and the vector of an interest is made of its text
export const missingWords = (profileText, interests, refused = []) => {
    const named = folded([...interests.map(interest => interest.text), ...(Array.isArray(refused) ? refused : [])]
        .filter(value => typeof value === 'string').join(' '));
    const words = String(profileText).split(/[^\p{L}\p{N}-]+/u)
        .map(word => word.replace(/^-+|-+$/g, ''))
        // "ATP", "VAR": short names in capitals count
        .filter(word => word.length >= 4 || (word.length >= 2 && word === word.toUpperCase() && /\p{L}/u.test(word)))
        .filter(word => !PROFILE_WORDS.has(word.toLowerCase()));

    const missing = words.filter(word => {
        const start = folded(word).slice(0, Math.max(4, word.length - 3));
        return !named.includes(start);
    });
    return [...new Set(missing)];
};

// Measured on the 3 profiles of the test accounts and 4 written for it (keywords only, English, familiar,
// a secondary interest), twice each: the prompt asking for all the words of the reader left none out
// (the one before: "nominations" and "changements" of the UEFA profile). A profile is split once when
// it is saved, so when a word still misses the AI is asked once more, and its second answer kept only
// when it misses fewer
export const interestsOf = async (profile) => {
    const prompt = interestsPrompt(profile);
    const answer = await ollamaJson(prompt);
    const interests = normalizeInterests(answer, profile);
    const missing = missingWords(profile.text, interests, answer?.refused);
    if (missing.length === 0 || interests.length === 0) return interests;

    const again = await ollamaJson([
        {role: 'user', content: prompt},
        {role: 'assistant', content: JSON.stringify(answer)},
        {role: 'user', content: `Ces mots du profil ne sont dans aucun "text" ni dans "refused" : ${missing.join(', ')}. Redonne toute ta réponse en ajoutant chacun, avec les mots qui l'entourent dans le profil, au "text" de l'intérêt qu'il précise, ou à "refused" si le lecteur le refuse. Ignore un mot qui ne dit aucun sujet.`},
    ]).catch(() => null);
    const retried = normalizeInterests(again, profile);
    return retried.length > 0 && missingWords(profile.text, retried, again?.refused).length < missing.length ? retried : interests;
};

// What the reader said of cards before, as examples: they say what the profile text does not ("no
// predictions", "more refereeing"). Only what makes them alike is refused, the prompt says so: one
// refused card on a match must not remove every match. Nothing when the reader gave no thumb, the
// prompt is then the one measured on the benches
const feedbackBlock = ({liked = [], refused = []} = {}) => (liked.length === 0 && refused.length === 0 ? '' : `
Ce lecteur a déjà jugé des histoires des jours passés. Sers-t'en pour comprendre ce qu'il veut vraiment, en plus de son profil :
${liked.length > 0 ? `il les a trouvées bonnes pour lui :\n${liked.map(title => `+ ${title}`).join('\n')}\n` : ''}${refused.length > 0 ? `il ne les voulait pas :\n${refused.map(title => `- ${title}`).join('\n')}\n` : ''}Cherche ce qui les rapproche (un genre d'article, un angle, un sujet précis) plutôt que de refuser tout ce qui parle des mêmes personnes, organisations ou lieux.
`);

// The prompt measured on the four profiles of the bench: 95% then 96% of relevant cards, and it
// answers fewer than ten stories when fewer fit (0 for the chef with the feeds of the start only).
// The user's refusals are left to it: as vectors they removed good stories as well as bad ones.
// Asked for ten, it gave the strongest interest most of them: 5 or 6 cards on AI of 9 for a reader of
// tennis, AI and Swiss politics, 1 or 2 on tennis with 12 to 14 tennis candidates. Its interests are
// given, it chooses up to MAX_CHOSEN and the briefing keeps a share of each (see balanceSelection).
// The rules other steps do were taken out: two stories of one news (merged by mergeStories before any
// summary), a precision read out of its subject (the review of the cards with their summary), the
// trusted sources (a bonus of their score, TRUST_BONUS). The others are said for any subject, the
// refusals with the example of the review (a looser one cost the reader of food 1 or 2 cards of 5 on
// restaurants as "people"). Measured on the 3 accounts, 2 to 4 runs each: the same share of each
// interest, 5 cards on refereeing of 10 for the UEFA one (3 before)
export const selectionPrompt = (profileText, candidates, examples = {liked: [], refused: []}, interests = []) => `Voici le profil d'un lecteur, écrit par lui-même :
"""${profileText}"""
${interests.length > 1 ? `Ses intérêts :\n${interests.map(interest => `- ${interest}`).join('\n')}\n` : ''}${feedbackBlock(examples)}
Voici des histoires d'actualité du jour, chacune avec son identifiant entre crochets :
${candidates.map(c => `[${c.id}] ${c.title}${c.description ? ` — ${c.description}` : ''}${c.others.length > 0 ? ` (aussi : ${c.others.join(' / ')})` : ''}`).join('\n')}

Choisis au plus ${MAX_CHOSEN} histoires qui correspondent vraiment à ce que ce lecteur demande, de la plus à la moins pertinente.${interests.length > 1 ? `
Couvre tous ses intérêts : pour chacun, donne les histoires qui lui conviennent, même quand un autre intérêt en a de plus fortes. Son résumé en gardera ${MAX_BRIEFING}, réparties entre ses intérêts.` : ''}
Ce qu'il dit ne pas vouloir est exclu, même quand l'histoire touche un de ses intérêts et même quand son titre ne le nomme pas (une équipe d'un sport refusé, un parti d'une politique refusée).
S'il y en a moins de ${MAX_CHOSEN} qui conviennent, n'en rends que celles-là : une liste courte vaut mieux qu'une histoire hors sujet.
Varie : pas deux histoires sur la même personne, la même organisation ou le même événement, sauf si ce sont deux nouvelles importantes et différentes.
Préfère les faits du jour (décisions, annonces, résultats, déclarations) aux pronostics, conseils et guides, sauf si le lecteur les demande. Ne choisis jamais une page qui n'apporte aucun fait nouveau : présentation générale d'un sujet, guide pratique, billetterie, classement, calendrier, direct, compilation.
Pour chacune, "why" est une phrase courte qui dit au lecteur pourquoi elle est pour lui, dans la langue de son profil, tirée seulement de ce que disent son titre et sa description : si le lien avec le profil n'y est pas, ne la choisis pas.
Réponds uniquement en JSON : {"selected": [{"id": "...", "why": "une phrase courte"}]}`;

// the stories chosen, only among the ones given, each once, at most MAX_CHOSEN
export const normalizeSelection = (answer, knownIds) => {
    const known = new Set(knownIds.map(String));
    const selected = new Map();

    for (const item of Array.isArray(answer?.selected) ? answer.selected : []) {
        // "[42]" is sometimes answered for 42
        const id = String(item?.id ?? '').replace(/^\[|\]$/g, '');
        if (known.has(id) && !selected.has(id)) selected.set(id, {id, why: cleanText(item?.why, 300)});
    }

    return [...selected.values()].slice(0, MAX_CHOSEN);
};

// The MAX_BRIEFING stories of a briefing among the ones the AI chose, in its order: each interest first
// gets its share of the places, by its weight (3 of 10 for each of 3 interests), then the places left
// go to the next stories of the AI whatever their interest. An interest with no story that fits leaves
// its places to the others.
// selected: [{id, why}], interestOf: id -> the id of the interest of the story, interests: [{id, weight}]
export const balanceSelection = (selected, interestOf, interests) => {
    const total = interests.reduce((sum, interest) => sum + interest.weight, 0);
    const shares = new Map(interests.map(interest => [interest.id, Math.max(1, Math.floor(MAX_BRIEFING * interest.weight / total))]));
    const taken = new Map();
    const kept = new Set();

    for (const item of selected) {
        const interest = interestOf(item.id);
        const count = taken.get(interest) ?? 0;
        if (kept.size < MAX_BRIEFING && count < (shares.get(interest) ?? 0)) {
            kept.add(item);
            taken.set(interest, count + 1);
        }
    }
    for (const item of selected) {
        if (kept.size < MAX_BRIEFING) kept.add(item);
    }

    return selected.filter(item => kept.has(item));
};

// candidates: [{id, title, description, others: [titles]}]
// examples: {liked: [titles], refused: [titles]}, the thumbs of the reader (see utils/feedback.js)
// interests: the texts of the interests of the reader
export const selectStories = async (profileText, candidates, usage = null, examples = undefined, interests = []) =>
    normalizeSelection(await ollamaJson(selectionPrompt(profileText, candidates, examples, interests), usage), candidates.map(c => c.id));

// The choice reads a title and the start of a description, which may not name what a story is about:
// "L'esprit d'Alexandre le Grand pour inspirer cette nouvelle Nati et Winsley Boteli?" is the Swiss
// football team, chosen twice for a reader of tennis who wrote "le football ne m'intéresse pas du
// tout" (the tennis interest names "les jeunes joueurs suisses"). Its summary says it: the cards are
// read once more with their summary, and the ones on what the reader refuses are left out. Only
// that: asked also for the cards far from the interests, it left out 6 good ones of 70 (a French
// tennis player on the ATP tour, a parliament hearing of OpenAI and Anthropic, a card with no summary).
// Its example is said for any subject: "a person, an organisation, a place of it" left out 6 good cards
// of 163 (federal credits as "cantonal politics", Top Chef restaurants as "people"), "a brand of a
// refused product" 2 cards on new AI models; "its main subject", with a team of a refused sport and a
// party of a refused politics, 1 card in 2 runs of the 163 (a resignation as "politics news in brief"),
// the Nati 6 times of 6
export const reviewPrompt = (profileText, cards) => `Voici le profil d'un lecteur, écrit par lui-même :
"""${profileText}"""

Voici les cartes de son résumé de l'actualité, chacune avec son identifiant entre crochets, son titre et le résumé de son article :
${cards.map(card => `[${card.id}] ${card.title}\n${card.summary || '(pas de résumé)'}`).join('\n\n')}

Le résumé dit de quoi parle vraiment une carte, mieux que son titre. Dis seulement quelles cartes ont pour sujet principal ce que le lecteur dit explicitement ne pas vouloir, même quand leur titre ne le nommait pas (une équipe d'un sport refusé, un parti d'une politique refusée). Une carte qui ne fait que mentionner un sujet refusé, ou qui s'en approche sans en être, est gardée.
Ne juge pas si une carte est assez proche de ses intérêts : elle a déjà été choisie pour eux, et une carte qui correspond à un seul d'entre eux est gardée. Un sujet que le profil ne mentionne pas n'est pas refusé pour autant : seul compte ce qu'il écrit ne pas vouloir. S'il n'écrit rien de tel, n'enlève aucune carte.
Une carte sans résumé est gardée. Dans le doute, garde la carte.
Réponds uniquement en JSON : {"refused": [{"id": "...", "why": "une phrase courte"}]}`;

// the ids of the cards to leave out, only among the ones given: Map id -> why
export const normalizeReview = (answer, knownIds) => {
    const known = new Set(knownIds.map(String));
    const refused = new Map();
    for (const item of Array.isArray(answer?.refused) ? answer.refused : []) {
        const id = String(item?.id ?? '').replace(/^\[|\]$/g, '');
        if (known.has(id) && !refused.has(id)) refused.set(id, cleanText(item?.why, 300));
    }
    return refused;
};

// cards: [{id, title, summary}]
export const reviewCards = async (profileText, cards, usage = null) =>
    cards.length === 0 ? new Map() : normalizeReview(await ollamaJson(reviewPrompt(profileText, cards), usage), cards.map(card => card.id));

// The stories are grouped by vectors, and two media writing on one subject can land in one story
// without telling the same fact (a product launch and a bug found in it). No threshold of the vectors
// separates them cleanly, so the AI reads the few stories of a briefing before they are shown, all in
// one call: which articles tell the news of the lead one. The card counts and lists only those.
// Measured on 30 cards read by hand (the biggest stories, stories taken at random, and stories still
// mixing two facts): gemma4:31b keeps 92% of the articles of the same news and drops 91% of the
// others. Without "keep the analyses, when in doubt keep it" it dropped a quarter of the good ones.
// Its examples of other news are said for any subject (they were mostly matches and players): 94% of the
// articles of the same news kept and 97% of the others dropped on those 30 cards (93% and 89% before).
// A shorter list ("what comes before an event", "a background explanation") dropped the previews and the
// analyses of the same meeting: 72% kept.
// About 1000 to 6500 tokens read and 400 written for ten cards, 2 seconds.
export const checkPrompt = (stories) => `Voici des histoires d'actualité, chacune avec son identifiant entre crochets. Chaque histoire a un
article principal (P) et d'autres articles, numérotés, regroupés automatiquement avec lui.

Pour chaque histoire, dis quels articles numérotés parlent de LA MÊME NOUVELLE que l'article principal :
le même événement précis (la même annonce, décision, rencontre, match, incident, déclaration, publication),
même avec d'autres mots ou sous un autre angle.
Un article d'analyse, d'opinion, d'explication, de réactions, de chiffres ou de conséquences sur ce même
événement en fait partie : garde-le. Dans le doute, si l'article parle de ce même événement, garde-le.
N'enlève que les articles dont l'événement principal est un AUTRE, même sur le même sujet, les mêmes
personnes ou la même organisation : un lancement de produit et un défaut trouvé ensuite, deux événements
du même genre (deux matchs, deux concerts, deux élections), les prévisions de deux pays, un discours et une
autre décision du même dirigeant, un événement et une autre affaire d'une personne qui y participe, une
explication de fond et un incident précis sur le même sujet, l'enjeu d'un événement à venir et une autre
déclaration faite avant lui par un de ses acteurs.

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
// a French one and an English one). Apart under their own heading, an explanation was taken for the
// decision it explains (evening briefings).
// Bench of 110 stories of two days in five lists (world, AI, society, sport, affairs: data/merge), the
// stories of one fact labelled by hand: the AI first writes the main fact of each story of the day, then
// compares it. With a list of cases (mostly matches) and no fact written, it joined 69 to 76% of the
// stories to their fact and 11 to 15% to another one, most into a shown card (the news hidden: a vote
// into its announcement, the stages of one visit, the verdict of a club and a coach's comment on it).
// With the fact written for the stories of the day and a short general rule: 78% and 7%, and with 40
// shown cards (a reader of a few days) 74% and 10% instead of 70% and 15%, 14 s instead of 10. The fact
// written for the shown cards too did a little better (78% and 12% with 40 of them) but took 33 s, and
// the short rule without the fact did no better than the list of cases. The announcement of a vote still
// takes in its result.
const storyLine = (story) => `[${story.id}] ${story.lead.title}${story.lead.description ? ` — ${story.lead.description}` : ''}`;

export const mergePrompt = (stories, shown = []) => `Voici les histoires d'un résumé de l'actualité, dans l'ordre, chacune avec son identifiant entre crochets.

Pour chaque histoire, dis si elle raconte le MÊME FAIT qu'une histoire PLUS HAUT dans la liste : le même
événement précis (la même annonce, décision, incident, verdict, résultat ou publication), même dans une
autre langue ou sous un autre angle (réactions, analyse, conséquences de ce même événement).
Deux faits de la même affaire, de la même personne ou du même événement ne sont pas le même fait : ce qui
précède un événement et son résultat, deux étapes d'une affaire, deux déclarations, un événement et ce
qui s'y est produit à côté.
Dans le doute, ce n'est pas le même fait : réponds null. Fusionner à tort cache une nouvelle au lecteur.

${[...shown, ...stories].map(storyLine).join('\n')}

${shown.length > 0 ? `Les histoires dont l'identifiant commence par "shown" ont déjà été montrées au lecteur : ne réponds que
pour les autres. Pour chacune` : 'Pour chaque histoire'}, écris d'abord son fait principal en quelques mots (qui a fait quoi), puis
compare-le à ceux des histoires plus haut.
Réponds uniquement en JSON : {"stories": [{"id": "...", "fait": "...", "sameAs": "identifiant d'une histoire plus haut" ou null}]}`;

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
