// Rules for the language of a feed and of a news, measured on bench/data/languages/features.json
// (see language-detect.mjs): the short words of 9 languages alone, and with franc for the others.
//   node bench/language-rules.mjs
import {readFileSync} from 'node:fs';
import {feedLanguage, languageOf} from '../services/utils/language.js';

const feeds = JSON.parse(readFileSync('bench/data/languages/features.json', 'utf8'));
const NINE = new Set(['fr', 'en', 'es', 'it', 'de', 'nl', 'pt', 'cs', 'pl']);
const ISO = {eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl', hun: 'hu',
    ell: 'el', hrv: 'hr', srp: 'sr', bos: 'bs', swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi', ron: 'ro', bul: 'bg',
    rus: 'ru', ukr: 'uk', bel: 'be', tur: 'tr', slk: 'sk', slv: 'sl', ekk: 'et', lvs: 'lv', lit: 'lt', kat: 'ka', hye: 'hy',
    azj: 'az', kaz: 'kk', mkd: 'mk', als: 'sq', heb: 'he', cat: 'ca', glg: 'gl', arb: 'ar', pes: 'fa', cmn: 'zh', jpn: 'ja',
    kor: 'ko', ind: 'id', vie: 'vi', tha: 'th', hin: 'hi'};
const iso = (code) => ISO[code] ?? null;

// the words of a language seen in a text, as languageOf counts them
const WORDS = {
    fr: 'le la les des une un du et est dans pour sur au aux avec par pas qui que ce cette son ses sont plus leur',
    en: 'the a an of and is in for on to with by not who that this his her are more from at as its was',
    es: 'el la los las un una del y es en para con por que se su sus al como más pero',
    it: 'il lo la gli le un una del della di e è in per con che si non al come più sono',
    de: 'der die das den dem des ein eine und ist im in für mit von auf nicht sich zu dass wird bei',
    nl: 'het een van op met voor niet zijn dat aan bij ook naar om wordt werd hun deze nog maar uit',
    pt: 'os um uma dos das em ao não com mais seu sua pelo pela foi são',
    cs: 'že jsou pro jak už jako ale od byl bylo jeho které který také nebo při',
    pl: 'się nie że jest jak po od już dla oraz przez był jego które który także tym',
};
const SETS = Object.entries(WORDS).map(([language, words]) => [language, new Set(words.split(' '))]);
const hitsOf = (text) => {
    const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
    let best = null, bestHits = 0;
    for (const [language, set] of SETS) {
        const hits = words.reduce((n, word) => n + (set.has(word) ? 1 : 0), 0);
        if (hits > bestHits) [best, bestHits] = [language, hits];
    }
    return {language: best, hits: bestHits};
};

// feed rules: [name, (feed) => language]
const bestNine = (top) => top.filter(([code]) => NINE.has(iso(code)))[0]?.[1] ?? 0;
const feedRules = [
    ['words only (today)', feed => feedLanguage(feed.news.map(n => n.text))],
    ['franc when outside the 9', feed => {
        const t = iso(feed.feedTop[0]?.[0]);
        return t && !NINE.has(t) ? t : feedLanguage(feed.news.map(n => n.text));
    }],
    ...[0.9, 0.95, 0.98].map(margin => [`franc outside the 9, the best of the 9 under ${margin}`, feed => {
        const t = iso(feed.feedTop[0]?.[0]);
        return t && !NINE.has(t) && bestNine(feed.feedTop) < margin ? t : feedLanguage(feed.news.map(n => n.text));
    }]),
];

const report = (title, rows) => {
    console.log(`\n${title}`);
    console.table(rows);
};

const groups = ['shared', 'directory', 'list'];
report('feeds told right', feedRules.map(([name, rule]) => Object.fromEntries([['rule', name], ...groups.map(from => {
    const of = feeds.filter(feed => feed.from === from);
    return [from, `${of.filter(feed => rule(feed) === feed.language).length}/${of.length}`];
})])));

const [, chosen] = feedRules[3];
const wrong = feeds.filter(feed => chosen(feed) !== feed.language).map(feed => `${feed.from} ${feed.language}->${chosen(feed)} ${feed.url}`);
console.log(`\nwrong with "${feedRules[3][0]}":\n${wrong.join('\n')}`);

// news rules, the language of their feed given (as the server knows it) or not
const newsRules = [
    ['words, feed as default (today)', (n, feed) => languageOf(n.text, feed) ?? 'en'],
    ...[3, 4, 5].map(strong => [`feed outside the 9 kept unless ${strong} words`, (n, feed) => {
        if (feed && !NINE.has(feed)) {
            const {language, hits} = hitsOf(n.text);
            return hits >= strong ? language : feed;
        }
        return languageOf(n.text, feed) ?? 'en';
    }]),
    ['no feed language: words (today)', n => languageOf(n.text) ?? 'en'],
    ['no feed language: words, then franc', n => {
        const {language, hits} = hitsOf(n.text);
        if (hits >= 2) return language;
        return iso(n.top[0]?.[0]) ?? 'en';
    }],
    ['no feed language: franc outside the 9 first', n => {
        const t = iso(n.top[0]?.[0]);
        if (t && !NINE.has(t) && bestNine(n.top) < 0.9) return t;
        const {language, hits} = hitsOf(n.text);
        return hits >= 2 ? language : t ?? 'en';
    }],
];
report('news told as their feed', newsRules.map(([name, rule]) => Object.fromEntries([['rule', name], ...groups.map(from => {
    const of = feeds.filter(feed => feed.from === from).flatMap(feed => feed.news.map(n => [n, feed.language]));
    const right = of.filter(([n, language]) => rule(n, name.startsWith('no feed') ? null : language) === language).length;
    return [from, `${(100 * right / of.length).toFixed(1)}% of ${of.length}`];
})])));

// franc for any language when the words tell none, and for one outside the 9 always
const combined = feed => {
    const t = iso(feed.feedTop[0]?.[0]);
    const words = feedLanguage(feed.news.map(n => n.text));
    if (t && (!words || !NINE.has(t))) return t;
    return words;
};
report('feeds told right, combined', [Object.fromEntries([['rule', 'franc when the words tell none or outside the 9'], ...groups.map(from => {
    const of = feeds.filter(feed => feed.from === from);
    return [from, `${of.filter(feed => combined(feed) === feed.language).length}/${of.length}`];
})])]);
console.log(feeds.filter(feed => combined(feed) !== feed.language).map(feed => `${feed.from} ${feed.language}->${combined(feed)} ${feed.url}`).join('\n'));

report('news, feed outside the 9 kept unless N words', [5, 6, 8, 99].map(strong => Object.fromEntries([['strong', strong], ...groups.map(from => {
    const of = feeds.filter(feed => feed.from === from).flatMap(feed => feed.news.map(n => [n, feed.language]));
    const rule = (n, feed) => {
        if (feed && !NINE.has(feed)) {
            const {language, hits} = hitsOf(n.text);
            return hits >= strong ? language : feed;
        }
        return languageOf(n.text, feed) ?? 'en';
    };
    return [from, `${(100 * of.filter(([n, language]) => rule(n, language) === language).length / of.length).toFixed(1)}%`];
})])));
