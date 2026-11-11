//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: statement-words.js
//  Description: The words of a statement or a communiqué in the languages of the news, for the badge "Official" of the events of an affair only
//
//  statements.js has the words of seven languages (English, French, Spanish, Portuguese, Italian, German, Dutch): they select the sentences the AI
//  reads for the "official source" of the cards, the field `statement` of the API of the news and what makes an event key (and so an alert). The
//  badge "Official" asks for such a word in some news of the event (affair-marks.js): with those seven languages only, an event told in Greek or in
//  Serbian could never be official. These words are added for the badge ALONE (the user, 11.11.2026): a card, the API and the alerts stay what they
//  were, and the other languages are to be measured there before they are added to statements.js
//

"use strict"

import {hasStatement} from './statements.js';

// By language: a statement, a communiqué, a press release, "officially", the verb that announces. A word is searched in any news, whatever its language
// ('|' at its start: a word begins there; at its end: it ends there), so the ones that are ordinary words of another language are not here
export const WORDS = {
    el: ['ανακοίνωσ', 'ανακοινώσ', 'δελτίο τύπου', 'επίσημα', 'επίσημη δήλωση'],
    // Serbian, Croatian, Bosnian, Slovenian, in the two alphabets
    sr: ['saopšten', 'saopćen', 'priopćen', 'priopštenj', '|službeno|', '|zvanično|', '|uradno|', 'sporočilo za javnost', 'саопштењ', 'званично', 'службено'],
    mk: ['соопштение', 'официјално'],
    ru: ['заявлени', 'пресс-релиз', 'пресс-служб', 'официально'],
    uk: ['заява', 'пресслужб', 'офіційно'],
    bg: ['прессъобщение', 'официално'],
    pl: ['|komunikat|', '|komunikatu|', '|komunikatem|', '|komunikaty|', '|oświadczeni', 'oficjalnie'],
    cs: ['tisková zpráva', 'tiskové prohlášení', 'prohlášení', 'oficiálně'],
    sk: ['vyhlásenie', 'tlačová správa', 'oficiálne'],
    hu: ['közlemény', 'nyilatkozat', 'hivatalosan'],
    ro: ['|comunicat', 'în mod oficial'],
    sq: ['|komunikatë', 'deklaratë', 'zyrtarisht'],
    tr: ['resmi açıklama', 'basın bülteni', '|resmen|'],
    ar: ['بيان رسمي', 'بيان صادر', 'في بيان', 'رسمياً', 'رسميا'],
    he: ['בהודעה', 'הצהרה', 'רשמית'],
    fa: ['بیانیه', 'رسما'],
    id: ['siaran pers', 'pernyataan resmi', 'secara resmi', 'mengumumkan'],
    vi: ['thông cáo', 'tuyên bố'],
    th: ['แถลงการณ์', 'อย่างเป็นทางการ'],
    ja: ['声明', '公式発表', '公式サイト'],
    ko: ['성명', '공식 발표', '공식 입장'],
    zh: ['声明', '聲明', '公告', '官方'],
    sv: ['pressmeddelande', 'uttalande', 'officiellt'],
    da: ['pressemeddelelse', 'udtalelse', 'officielt'],
    no: ['pressemelding', 'uttalelse', 'offisielt'],
    fi: ['tiedote', 'lausunto', 'virallisesti'],
    lt: ['oficialiai', 'pranešime'],
    lv: ['paziņojum', 'oficiāli'],
    et: ['pressiteade', 'ametlikult'],
    ca: ['comunicat', 'oficialment'],
};

const bare = (word) => word.replace(/^\||\|$/g, '');
const WORD_EDGE = String.raw`[\p{L}\p{N}]`;
const alternative = (word) => `${word.startsWith('|') ? `(?<!${WORD_EDGE})` : ''}${bare(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${word.endsWith('|') ? `(?!${WORD_EDGE})` : ''}`;
const PATTERN = new RegExp(`(${[...new Set(Object.values(WORDS).flat())].sort((a, b) => bare(b).length - bare(a).length).map(alternative).join('|')})`, 'iu');

// the word of the languages added that a text holds, in lower case, null when it holds none
export const statementWordOf = (text) => PATTERN.exec(String(text ?? ''))?.[1].toLowerCase() ?? null;

// whether a text holds the words of a statement or of a communiqué, in the seven languages of statements.js or in the ones added here
export const hasOfficialStatement = (text) => hasStatement(text) || statementWordOf(text) !== null;
