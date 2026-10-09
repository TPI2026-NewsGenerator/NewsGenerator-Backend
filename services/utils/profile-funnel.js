//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: profile-funnel.js
//  Description: A profile written with the AI: the reader writes a few words, the AI asks questions in
//               rounds, each with choices to tick and room for their own words, then writes the profile
//               from what they ticked and wrote. The reader reads it, changes it if they want, and
//               saves it as a profile written by hand: the interests are read in it as in any other
//

"use strict"

import {ollamaJson} from './ollama.js';
import {languageName} from './language.js';

// Measured on 5 profiles of real readers, the AI playing the reader who knows their text and answers
// only what is asked (bench/profile-funnel.mjs, 4 runs each, 9.10.2026): from "Je travaille dans
// l'arbitrage à l'UEFA." the interests found 50% of the news of 48 h the ones of the real text of 1 085
// characters find (19% for the start alone, 69 to 92% for the real text split again), from
// "L'astronomie." 34% (1%), "Les cartes Pokémon." 33% (34%), "Je suis informaticien." 29% (10%),
// "Le tennis." 17% (1%), whose reader also follows AI and Swiss politics. 6 to 8 questions, 1 to 4 s each call
export const MAX_ROUNDS = 3;
export const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
export const MIN_START = 3;
export const MAX_START = 300;
const MAX_QUESTION = 200;
const MAX_OPTION = 80;
export const MAX_FREE = 400;
const MAX_TEXT = 2000;          // a profile, see profile-service.js

const today = () => new Date().toLocaleDateString('fr-CH', {day: 'numeric', month: 'long', year: 'numeric'});
const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const list = (value) => Array.isArray(value) ? value : [];

// the questions as the AI answers them: each with its choices, never twice the same
export const normalizeQuestions = (answer) => list(answer?.questions)
    .map(q => ({
        question: clean(q?.question, MAX_QUESTION),
        options: [...new Set(list(q?.options).map(option => clean(option, MAX_OPTION)).filter(Boolean))].slice(0, MAX_OPTIONS),
    }))
    .filter(q => q.question)
    .slice(0, MAX_QUESTIONS);

// The rounds as the page sends them back, answered: [[{question, options, chosen, free}]]. What the
// reader ticked must be one of the choices; nothing in them is trusted more than the reader's own words
export const cleanRounds = (rounds) => list(rounds).slice(0, MAX_ROUNDS).map(round => list(round).slice(0, MAX_QUESTIONS).map(q => {
    const options = [...new Set(list(q?.options).map(option => clean(option, MAX_OPTION)).filter(Boolean))].slice(0, MAX_OPTIONS);
    return {
        question: clean(q?.question, MAX_QUESTION),
        options,
        chosen: [...new Set(list(q?.chosen).map(option => clean(option, MAX_OPTION)))].filter(option => options.includes(option)),
        free: clean(q?.free, MAX_FREE),
    };
}).filter(q => q.question)).filter(round => round.length > 0);

const skipped = ({chosen, free}) => chosen.length === 0 && !free;

const transcript = (start, rounds) => `Ce qu'il a écrit au départ : """${start}"""
${rounds.flatMap(round => round.map(({question, options, chosen, free}) =>
    `- Question : ${question}${options.length ? `\n  Choix proposés : ${options.join(' ; ')}` : ''}\n  ${skipped({chosen, free})
        ? 'Il l\'a passée sans rien cocher ni écrire.'
        : `Il a coché : ${chosen.length ? chosen.join(' ; ') : 'rien'}${free ? `\n  Il a écrit : ${free}` : ''}`}`)).join('\n')}`;

// the words that tell what a question is about: the ones of asking ("quels", "vous", "souhaitez") left out
const ASKING = new Set(['quel', 'quels', 'quelle', 'quelles', 'vous', 'votre', 'vos', 'pour', 'dans', 'avec', 'sont', 'souhaitez',
    'voulez', 'aimeriez', 'suivre', 'suivez', 'interessent', 'interesse', 'what', 'which', 'your', 'would', 'like', 'follow', 'want']);
const topicWords = (text) => new Set((text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}{4,}/gu) ?? [])
    .filter(word => !ASKING.has(word)));

// a question asked again after the reader passed it: the AI is told it was, and still asked it again
// in the same words (9.10.2026)
const askedAgain = (question, passed) => {
    const words = topicWords(question);
    return passed.some(old => {
        const shared = [...words].filter(word => old.has(word)).length;
        return shared >= 2 && shared / Math.min(words.size, old.size) >= 0.75;
    });
};

// The rules are the ones the bench needed: without them the choices left the domain of the reader
// (FIBA and CEV for a referee of football), excluded each other (« Uniquement… »), asked for the
// reader's sources, came back after no answer, came in English to a French start, then in one language
// one round and another the next when told to follow the start's ("Le tennis.": the reader's language
// is now the one chosen, the one asked in, 9.10.2026); a reader of tennis,
// AI and Swiss politics only ever spoke of tennis until a question asked for other subjects, and named
// only one of them when asked once. What counts most was never said without a question: every interest
// came out at the weight 1. Asked which subjects to follow closely, the reader ticked them all and details
// came as choices, an unticked "Ligue 1" falling to 0.85; asked which to follow from afar, nothing ticked
// leaves them at 1 (bench/profile-importance.mjs: 9 of 9 subjects from afar at 0.85, no false one)
export const questionsPrompt = ({start, rounds, language}) => `Nous sommes le ${today()}. Un lecteur crée son profil pour recevoir chaque jour un résumé de l'actualité choisi pour lui, parmi les nouvelles de médias de toutes les langues, traduites en ${languageName(language, 'fr')}. Il a commencé par quelques mots, et tu l'aides à les préciser par des questions.
${transcript(start, rounds)}

Ce tour est le ${rounds.length + 1}e sur ${MAX_ROUNDS}. Le profil doit dire, pour choisir ses nouvelles parmi des milliers :
- ses sujets, précisément : les organisations, compétitions, personnes, fonctions (celles dont les changements comptent pour lui), lieux, produits ou domaines qu'il suit ;
- quelles nouvelles de ces sujets il veut (décisions, nominations, résultats, règles, argent, sorties, découvertes…) ;
- jusqu'où : quels pays ou régions, quel niveau, aussi les moins connus ;
- pourquoi il les suit (son métier, sa passion) : cela dit l'angle qui compte pour lui ;
- lesquels de ses sujets comptent le plus : ceux qu'il suit de près, et ceux qu'il suit de plus loin, seulement quand il s'y passe quelque chose d'important ;
- ce qu'il ne veut pas : les nouvelles voisines de ses sujets qu'un résumé lui donnerait à tort.
Pose 2 à ${MAX_QUESTIONS} questions sur ce qui n'est pas encore clair, jamais sur ce qu'il a déjà dit. Une question qu'il a passée ne revient pas, ni sous d'autres mots : ce point ne l'intéresse pas. Une question porte sur un seul point, courte, en ${languageName(language, 'fr')}, ses choix aussi, quelle que soit la langue de ce qu'il a écrit. Elle se dit avec des mots de tous les jours, comme on le demanderait de vive voix (« Quels pays vous intéressent ? »), jamais avec des mots de spécialiste (« portée », « périmètre », « veille »). Ses choix y répondent : jamais une question par oui ou non (« Voulez-vous suivre d'autres sujets ? »), mais « Quels autres sujets suivez-vous ? » ; il la passe si aucun ne lui va.
Au premier tour, une des questions demande quels autres sujets il veut suivre, avec comme choix des domaines variés de l'actualité : il a peut-être commencé par un seul. S'il en a coché ou nommé, le tour suivant lui demande encore s'il en suit d'autres, avec d'autres domaines comme choix. Un domaine coché peut être un angle de son premier sujet plutôt qu'un sujet à part (la politique, le droit, l'argent, les relations internationales d'un sport, d'une entreprise, d'une science) : la question qui le précise propose des choix dans son premier sujet d'abord, puis en général. Ceux qu'il nomme sont précisés aux tours suivants comme le premier. D'un tour à l'autre, va plus loin dans ce qu'il a coché ou écrit : un sujet qu'il a nommé sans dire lesquelles de ses nouvelles il veut mérite sa propre question. Ne demande jamais ses sources, ses formats ou la fréquence : ce sont ses sujets qui comptent.
Pour chacune, propose 4 à ${MAX_OPTIONS} choix courts et concrets, tous dans son domaine, tirés de son monde réel (des noms d'organisations, de compétitions, de fonctions, des genres de nouvelles), actuels : jamais l'édition d'une année passée. Couvre largement ce qu'il pourrait vouloir sur ce point, du plus courant au moins attendu. Les choix ne s'excluent pas : il en coche plusieurs, jamais de « uniquement » ni de « tout ». Il pourra aussi écrire avec ses mots.
Au plus tard au dernier tour, demande ce qu'il ne veut pas, avec comme choix les nouvelles voisines de ses sujets qui viennent souvent avec eux.
Quand il suit au moins deux sujets, au plus tard au dernier tour, demande lesquels il lui suffit de suivre de loin, seulement quand il s'y passe quelque chose d'important : les choix sont ses grands sujets, chacun nommé comme il l'a dit (« le tennis », « la politique suisse »), jamais leurs détails. Ceux qu'il ne coche pas, il les suit de près. Avec un seul sujet, ne le demande pas.
"enough" est true, sans question, quand tous ces points sont clairs.
Réponds uniquement en JSON : {"enough": false, "questions": [{"question": "...", "options": ["..."]}]}`;

// Without these rules the profile summed up ("various competitions"), repeated a choice ticked and the
// same point written, kept the capitals of the choices, and spoke of the questions ("concerning my watch");
// told to write what counts most, it once put "de plus loin" on the tournaments of a reader never asked
export const writePrompt = ({start, rounds, language}) => `Un lecteur a créé son profil de lecteur de nouvelles : il a écrit quelques mots, puis répondu à des questions.
${transcript(start, rounds)}

Écris son profil, à la première personne, comme s'il l'avait écrit lui-même, en ${languageName(language, 'fr')} (traduis-y ce qu'il a coché ou écrit dans une autre langue). Mets-y tout ce qu'il a coché et écrit, avec ses mots, sans en résumer ni en enlever aucun : chaque nom, chaque genre de nouvelle compte. N'ajoute rien qu'il n'a ni coché ni écrit : un choix qu'il n'a pas coché n'est ni voulu ni refusé, ne le cite pas. Quand un choix coché et ce qu'il a écrit se contredisent, ce qu'il a écrit compte.
Dis chaque chose une seule fois : ce qu'il a coché et écrit sur le même point se fond en une phrase. Un choix coché s'écrit comme un mot de la phrase (« les sanctions », pas « la Discipline et sanctions »). Pas de phrase sur la manière dont il répond (« concernant », « pour ma veille ») : seulement ce qu'il suit.
Commence par ce qui compte le plus pour lui et pourquoi, puis le reste, et finis par ce qu'il ne veut pas, en une phrase. Combien un sujet compte, seul ce qu'il a répondu le dit : un sujet qu'il a coché ou écrit vouloir suivre de loin le dit dans sa phrase, « de plus loin » ; aucun autre, jamais, même cité en dernier. Des paragraphes courts, pas de liste.
Réponds uniquement en JSON : {"text": "..."}`;

// {enough, questions}: the questions of the next round, none after the last one or when the AI has
// enough. start and rounds as cleaned above
export const nextQuestions = async ({start, rounds, language}, usage = null) => {
    if (rounds.length >= MAX_ROUNDS) return {enough: true, questions: []};
    const answer = await ollamaJson(questionsPrompt({start, rounds, language}), usage);
    // a first round is always asked: a few words never say enough
    const passed = rounds.flat().filter(skipped).map(q => topicWords(q.question));
    const questions = answer?.enough === true && rounds.length > 0 ? [] : normalizeQuestions(answer)
        .filter(q => !askedAgain(q.question, passed));
    return {enough: questions.length === 0, questions};
};

// the profile written from the start and the answers, its paragraphs kept; '' when the AI wrote none
export const writeProfile = async ({start, rounds, language}, usage = null) => {
    const text = (await ollamaJson(writePrompt({start, rounds, language}), usage))?.text;
    return typeof text === 'string' ? text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT) : '';
};
