//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: mentions.js
//  Description: The names the tagger finds in a news (ner/server.py), as they are stored and compared,
//               and the ones of a card rare enough to find the other news of its affair. Pure
//

"use strict"

export const KINDS = ['person', 'organization', 'location'];
// the places that found no item before this date are looked for once more when a card names them (see MentionModel.want): the rules that
// link a place changed (the Wikipedia of its language, the country the items called so share), 8.11.2026; the preposition of a headline taken off
// the name of the place ("En Corse"), 9.11.2026
export const PLACES_RULES_FROM = new Date('2026-11-10T00:00:00Z');
const MAX_NAME = 120;

// "La Fédération lettone de football" and "Fédération lettone de football" are one name; "Los Angeles"
// and "Le Mans" keep theirs: an article goes only when two words at least are left
const ARTICLES = /^(the|le|la|les|der|die|das|el|los|las|il|lo|gli|het)\s+(?=\S+\s+\S)/;
const EDGES = /^[\s"'«»“”„‘’`()[\]{}.,:;!?|/\\*–—-]+|[\s"'«»“”„‘’`()[\]{}.,:;!?|/\\*–—-]+$/g;
// the letters with no accent to take off, written as without one ("Wisła Kraków", "Wisla Krakow")
const LETTERS = {ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', þ: 'th', ð: 'd', ħ: 'h'};

// The name as it is compared: small letters, no accent, one space between words, no quote nor dot
// around it, no "'s" of the English possessive ("UEFA's"), no leading article. '' for none
export const mentionKey = (name) => String(name ?? '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđßæœıþðħ]/g, letter => LETTERS[letter])
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(EDGES, '')
    .replace(/'s$/, '')
    .replace(ARTICLES, '')
    .trim();

// The acronyms inside a longer name: the tagger gives "UEFA Nations League", "FIFA-Präsident", "Le
// PSG" as one name, and the news names the UEFA, the FIFA, the PSG too. On 2662 news of 30 days
// (bench/ner-recall.mjs, 13.10.2026) the names of the UEFA were in 72 of what the tagger read and in 35
// of its names, Infantino in 17 and 16. A roman figure ("LFF II lyga") is none
// The words that name a KIND of club or association are none: "FA" of "Japan FA", "FA Cup", "The FA", "FC" of "FC Barcelona", "AS Roma", "Valencia CF". Added
// so they were organisations of their own, 67 482 mentions of "FC" (linked to the concept "association football club"), 9 274 of "AS", 5 105 of "RC"
// (linked to RC Strasbourg), 2 928 of "FA" (1 029 of the 1 400 news of 30 days named a longer name holding it, 74%: the bare FA the 371 others write
// is the English association, Football Australia, the Egyptian one... according to the press). 74 to 100% of the news of each hold a longer name,
// against 9 to 43% for the bodies of two or three letters (OM, EU, UN, AZ, AFC), which stay (bench/acronym-types, 11.11.2026). "SK" stays: SK Hynix is a
// company of the SK group, SK Rapid a club
const KINDS_OF_CLUB = new Set(['FA', 'FC', 'AS', 'SC', 'AC', 'CF', 'SV', 'RC', 'FK', 'IF', 'FF', 'IK', 'UD']);
const ACRONYM = /^[A-Z][A-Z0-9&]{1,5}$/;
const ROMAN = /^[IVXLCDM]+$/;
export const acronymsOf = (name) => {
    const words = name.split(/[\s\-–/]+/);
    return words.length < 2 ? [] : words.filter(word => ACRONYM.test(word) && /[A-Z].*[A-Z]/.test(word) && !ROMAN.test(word) && !KINDS_OF_CLUB.has(word));
};

// The particles Korean and Japanese glue to a name written in Latin letters: "KFA는" is the KFA (the tagger gave 349 organisations
// so, 8.11.2026). A word of the language after the name is none ("AC밀란", "FIFA회장" stay as they are)
const PARTICLES = '은|는|이|가|을|를|의|와|과|도|에|로|으로|에서|에게|부터|까지|만|が|は|を|に|の|で|と|も|へ|や|から|まで|より';
const WITH_PARTICLE = new RegExp(`^([\\p{Script=Latin}\\d][\\p{Script=Latin}\\d&.'’ -]*[\\p{Script=Latin}\\d])(?:${PARTICLES})$`, 'u');
export const withoutParticle = (name) => WITH_PARTICLE.exec(name)?.[1] ?? name;

// A person written with no space between its parts (Korean, Japanese, Chinese) is a name in full as one with a space is, not a word alone ("Pedri",
// "Infantino"), when it has the shape of one. Of the 5 602 Korean and 2 597 Japanese persons of the database 16 and 0 were linked (11.11.2026): all
// were taken for a word alone, which Wikidata is asked last (110 000 names with a space wait before them, see MentionModel.toLink) and whose item
// must be labelled so in English ("손흥민", 71 news, looked for and left with no item).
//  - Korean: a family name of Korea and two or three syllables ("손흥민", "구자욱"). A foreign family name alone in hangul ("트럼프", "디아즈", 158 and
//    47 news) starts with none, or is longer, and is a word alone as "Trump" is
//  - Japanese and Chinese: 3 to 8 letters of han, kana, the prolonged sound mark and the middle dot, with a han ("大谷翔平", "山本由伸", "小柳ルミ子") or a
//    middle dot between katakana ("ミゲル・ロハス"). A family name alone is two han ("宮本"), a foreign one in katakana with no dot ("インファンティーノ",
//    "アリソン") is a word alone, and a clause the tagger took for a name is longer
// the position of a footballer glued to a Japanese name, before or after it ("FW大橋祐紀", "ローレンス・マルコDF")
const POSITIONS = ['GK', 'DF', 'MF', 'FW', 'CB', 'SB', 'LB', 'RB', 'WG', 'CF', 'OH', 'SH', 'SS'];
const POSITION = POSITIONS.join('|');
export const HANGUL_FAMILY_NAMES = [...new Set('김이박최정강조윤장임한오서신권황안송류유홍전고문양손배백허남심노하곽성차주우구나민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉사부갈태피호감독리라림빈간승곡상동목팽단당가두형화시경낭견')].join('');
const HANGUL_NAME = new RegExp(`^[${HANGUL_FAMILY_NAMES}][가-힣]{2,3}$`);
// han, kana, the prolonged sound mark and the middle dot, 3 to 8 letters with a han; a foreign name in katakana is longer, with its middle dot
const HAN_LETTERS = '[\\u3040-\\u30ff\\u3400-\\u9fff々ー・]{3,8}';
const KATAKANA_LETTERS = '[\\u30a1-\\u30fa\\u30fc]{2,10}・[\\u30a1-\\u30fa\\u30fc・]{2,12}';
const HAN_NAME = new RegExp(`^(?:${POSITION})?${HAN_LETTERS}(?:${POSITION})?$`);
const KATAKANA_NAME = new RegExp(`^(?:${POSITION})?${KATAKANA_LETTERS}(?:${POSITION})?$`);
const unspacedFullName = (name) => HANGUL_NAME.test(name) || (HAN_NAME.test(name) && /[\u3400-\u9fff]/.test(name)) || KATAKANA_NAME.test(name);
// the same in SQL, on the column name: the names of the database that are in full with no space
export const UNSPACED_FULL_NAME_SQL = `(name ~ '^[${HANGUL_FAMILY_NAMES}][가-힣]{2,3}$'
    OR (name ~ '^(?:${POSITION})?${HAN_LETTERS}(?:${POSITION})?$' AND name ~ '[\\u3400-\\u9fff]')
    OR name ~ '^(?:${POSITION})?${KATAKANA_LETTERS}(?:${POSITION})?$')`;
export const isFullName = (name) => mentionKey(name).includes(' ') || unspacedFullName(String(name ?? '').trim());

// The languages a Korean, Japanese or Chinese name is looked for in, from its own letters: the language kept with the name is the one its first news had, and
// of the 5 619 Korean persons 3 518 had none and 206 were labelled English, the search going out in English (11.11.2026). Hangul is Korean, kana Japanese, han
// alone Japanese or Chinese (the language of its news first). null for a name in other letters: the caller's language stands
export const cjkLanguages = (name, lang = null) => {
    if (/\p{Script=Hangul}/u.test(name)) return ['ko'];
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) return ['ja'];
    if (/\p{Script=Han}/u.test(name)) return lang === 'zh' ? ['zh', 'ja'] : ['ja', 'zh'];
    return null;
};

// The forms of a name to look for, the name first: what the tagger takes for the name often holds a word of the language glued to it. Korean: a particle
// ("구자욱이", 58 news, "김민재를") and a title, after a space or glued ("박진만 감독", 62 news, "박재만 기자", 92: a byline). Japanese: a position before or
// after ("FW大橋祐紀", "ローレンス・マルコDF"), a title ("宮本恒靖会長", "筒香嘉智内野手", "ロバーツ監督") and the particles and "et al" ("上田綺世は", "佐藤龍之介ら"),
// the ones in hiragana only after han, katakana or Latin letters (the last letter of "さくら" is none). Taken off one at a time, the form kept at
// two letters at least, so that a name which is only a title or "이 대통령" has no other form. The name as it is comes first: a real name which ends
// like a particle is found before the form without it. Looked for in the order, the first that Wikidata knows is the name (see linkPerson)
const KOREAN_PARTICLES = ['으로', '에서', '에게', '부터', '까지', '처럼', '보다', '이랑', '은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '에', '로', '만', '랑'];
const KOREAN_TITLES = ['대통령', '위원장', '구단주', '내야수', '외야수', '감독', '기자', '선수', '회장', '대표', '의원', '교수', '후보', '장관', '총리', '코치', '사장', '총재', '심판', '투수', '포수', '단장', '주장', '씨', '님'];
const JAPANESE_TITLES = ['ヘッドコーチ', 'キャプテン', '副会長', '内野手', '外野手', '会長', '監督', '投手', '捕手', '選手', '主将', '騎手', '審判', '主審', '社長', '首相', '大統領', '代表', '容疑者', '被告', 'コーチ', '氏'];
const JAPANESE_AFTER = ['さん', 'から', 'まで', 'より', 'ら', 'が', 'は', 'を', 'に', 'の', 'で', 'と', 'も', 'へ', 'や'];
const HIRAGANA_END = /[\u3041-\u309f]$/;
const longEnough = (stem) => [...stem].length >= 2;
const withoutEnding = (name, endings, {afterHiraganaToo = true} = {}) => {
    for (const ending of endings) {
        if (!name.endsWith(ending)) continue;
        const stem = name.slice(0, -ending.length).trimEnd();
        if (longEnough(stem) && (afterHiraganaToo || !HIRAGANA_END.test(stem))) return stem;
    }
    return null;
};
// each step once, in the order of the text: after a particle taken off the title is next, never another particle ("박재만" ends like one, "박재" is no form)
const hangul = (name) => /\p{Script=Hangul}/u.test(name);
const japanese = (name) => !hangul(name) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name);
const LEADING_POSITION = (name) => {
    const position = POSITIONS.find(tag => name.startsWith(tag) && /^\P{ASCII}/u.test(name.slice(tag.length)) && longEnough(name.slice(tag.length)));
    return position ? name.slice(position.length) : null;
};
const STEPS = [
    [hangul, [name => withoutEnding(name, KOREAN_PARTICLES), name => withoutEnding(name, KOREAN_TITLES)]],
    [japanese, [name => withoutEnding(name, JAPANESE_AFTER, {afterHiraganaToo: false}), name => withoutEnding(name, JAPANESE_TITLES),
        name => withoutEnding(name, POSITIONS), LEADING_POSITION]],
];
export const nameForms = (name) => {
    const forms = [String(name ?? '')];
    const steps = STEPS.find(([applies]) => applies(forms[0]))?.[1] ?? [];
    for (const step of steps) {
        const next = step(forms.at(-1));
        if (next && !forms.includes(next)) forms.push(next);
    }
    return forms;
};

// The preposition the tagger took for the start of a place when a headline opens with it: "En Corse, l'arbitrage…" gave the place "En Corse", which
// Wikidata does not know, and the card had no country (the briefing of Enzo of 9.11.2026); "En Corée du Sud", "Au Maroc", "À Paris" the same. Only the
// prepositions of the language of the name that are no word of a name in it (the "A" of "A Coruña", the "Al" of "Al Ain", the "In" of "In Salah" stay),
// and only before a capital: "Au greffe", "En otras latitudes" are no place
const PREPOSITIONS = {fr: ['en', 'au', 'aux', 'à'], es: ['en'], it: ['in', 'nel', 'nella', 'nello', 'nei', 'nelle'], pt: ['em', 'no', 'na', 'nos', 'nas']};
export const withoutPreposition = (name, language) => {
    const found = /^(\p{L}+)\s+(\p{Lu}.*)$/u.exec(String(name ?? '').trim());
    return found && (PREPOSITIONS[language] ?? []).includes(found[1].toLowerCase()) ? found[2] : name;
};

// The names of one news as stored: once per name and kind, of the kinds asked, a letter at least and
// not too long (a sentence taken for a name), and the acronyms inside them as organisations.
// entities: as the tagger gives them, [{text, label, score}]
export const cleanMentions = (entities) => {
    const seen = new Set();
    const names = [];
    const add = (name, kind) => {
        const key = mentionKey(name);
        if (!KINDS.includes(kind) || key.length < 2 || name.length > MAX_NAME || !/\p{L}/u.test(key)) return false;
        if (seen.has(`${kind} ${key}`)) return true;
        seen.add(`${kind} ${key}`);
        names.push({key, kind, name});
        return true;
    };
    for (const entity of Array.isArray(entities) ? entities : []) {
        const name = withoutParticle(String(entity?.text ?? '').replace(/\s+/g, ' ').replace(EDGES, ''));
        if (add(name, entity?.label)) acronymsOf(name).forEach(acronym => add(acronym, 'organization'));
    }
    return names;
};

// The names of a card that find the other news of its affair: a person or a body (a country or a city
// is named by too many news), named by the most news of the card, then by the fewest news of the month:
// the Latvian federation (LFF) finds what it said a week before, the UEFA every news of football. A
// name only the card holds finds nothing more. rows: [{id, kind, inCard, news}], news counted up to
// rare + 1
export const rareNames = (rows, {rare, max}) => rows
    .filter(row => row.kind !== 'location' && row.news <= rare && row.news > row.inCard)
    .sort((a, b) => b.inCard - a.inCard || a.news - b.news)
    .slice(0, max);
