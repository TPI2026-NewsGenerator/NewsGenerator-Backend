//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: funnel-variants.mjs
//  Description: Variants of the choosing prompt (selectionPrompt of profile-ai.js) replayed by bench/funnel-audit.mjs choose. v0 is the prompt as it is; the others add
//               a sentence about the SPORT of the reader (a review of 12.11.2026 found 3 cards of basketball in the briefing of a reader of football refereeing)
//

const ANCHOR = "Ce qu'il dit ne pas vouloir est exclu";
const after = (base, text) => {
    const at = base.indexOf(ANCHOR);
    if (at < 0) throw new Error('anchor not found in the prompt');
    const end = base.indexOf('\n', at);
    return `${base.slice(0, end)}\n${text}${base.slice(end)}`;
};

export const SPORT_RULE = "Le lecteur suit le ou les sports que son profil nomme. Une histoire dont le sujet principal est un AUTRE sport (sa fédération, sa ligue, ses arbitres, ses joueurs) n'est pas pour lui, même quand elle touche un sujet qu'il suit (un arbitre, l'élection d'une fédération, un sponsor), sauf si son profil nomme ce sport ou le sport en général.";
export const ACRONYM_SPORT_RULE = " Des sigles de sports différents se ressemblent (EOK, basket-ball, et EPO, football, en Grèce ; ABA, ligue de basket-ball) : ne conclus pas d'un sigle seul, et si le titre ou la description nomme un autre sport, c'est ce sport.";

export const PROMPT_VARIANTS = {
    v0: (base) => base,
    v1: (base) => after(base, SPORT_RULE),
    v2: (base) => after(base, SPORT_RULE + ACRONYM_SPORT_RULE),
};
