//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: measure.mjs
//  Description: How right the countries shown on the cards of the briefings are (the user, 11.11.2026: "il me semble qu'il n'est pas très précis"): real cards
//               of the last saved briefings, the countries the product showed on each, and the countries two blind judges say the news is about
//               (the definition the AI of country-choice.js is given: where it takes place, or whose main actors are; not the country of the medium,
//               nor the seat of an international body, nor a person named in passing; none in doubt). Never saved anything, reads the briefings
//
//  node --env-file=.env bench/countries/measure.mjs build [cards=120] [briefings to skip=0]    bench/data/countries/dataset.json, blind chunks in judge/
//      (COUNTRIES_DIR=bench/data/countries-fresh: another sample, of older briefings, without the cards of the first one)
//  node --env-file=.env bench/countries/measure.mjs run                  the AI of the product that reads each card (readCountries), bench/data/countries/out-ai.json
//  node --env-file=.env bench/countries/measure.mjs e2e                  the whole pipeline (namesAndCountriesOfCards) run again on the same cards, out-e2e.json
//  node --env-file=.env bench/countries/measure.mjs score                the labels (labels-<judge>-<chunk>.json) against what the cards show, and the ways to decide
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {newUsage} from '../../services/utils/ollama.js';
import {countryName} from '../../services/utils/country-names.js';
import {readCountries} from '../../services/utils/country-choice.js';

// COUNTRIES_DIR: another folder for another sample (bench/data/countries-fresh), the first one being the 120 cards the rules were set on
const FIRST_DIR = 'bench/data/countries';
const DIR = process.env.COUNTRIES_DIR ?? FIRST_DIR;
const BRIEFINGS = 14;
const TEXT = 450;

const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (text, n) => text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, '')}…`;
const read = (name) => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8'));
const write = (name, data) => writeFileSync(`${DIR}/${name}`, JSON.stringify(data, null, 1));

const build = async (count, offset = 0) => {
    mkdirSync(`${DIR}/judge`, {recursive: true});
    const briefings = await prisma.$queryRawUnsafe(`SELECT id, id_profile, items FROM briefings WHERE status = 'ready' AND id_profile IS NOT NULL ORDER BY id DESC LIMIT ${BRIEFINGS} OFFSET ${offset}`);
    // the cards of the first sample are never judged twice
    const seen = new Set(DIR !== FIRST_DIR && existsSync(`${FIRST_DIR}/dataset.json`) ? JSON.parse(readFileSync(`${FIRST_DIR}/dataset.json`, 'utf8')).map(card => card.storyId) : []);
    const cards = [];
    for (const briefing of briefings) {
        for (const item of briefing.items ?? []) {
            if (!Number.isInteger(item.storyId) || item.storyId <= 0 || seen.has(item.storyId)) continue;
            seen.add(item.storyId);
            cards.push({briefing: briefing.id, profile: briefing.id_profile, storyId: item.storyId, language: item.language ?? null, title: squash(item.title),
                titleTranslation: item.titleTranslation ? squash(item.titleTranslation) : null, text: cut(squash(item.translation ?? item.summary ?? item.points ?? ''), TEXT),
                shown: Array.isArray(item.countries) ? item.countries : [],
                names: (item.names ?? []).map(name => ({name: name.name, kind: name.kind, qid: name.qid ?? null}))});
        }
    }
    const random = seeded(11112028);
    const chosen = cards.map(card => ({card, k: random()})).sort((a, b) => a.k - b.k).slice(0, count).map((one, i) => ({id: i + 1, ...one.card}));
    write('dataset.json', chosen);
    const blind = chosen.map(({id, language, title, titleTranslation, text}) => ({id, language, title, translation: titleTranslation, text}));
    const half = Math.ceil(blind.length / 2);
    write('judge/chunk-A.json', blind.slice(0, half));
    write('judge/chunk-B.json', blind.slice(half));
    console.log(`${cards.length} cards in ${briefings.length} briefings, ${chosen.length} chosen; ${chosen.filter(card => card.shown.length > 0).length} show a country (${Math.round(100 * chosen.filter(card => card.shown.length > 0).length / chosen.length)}%)`);
};

// The AI that reads each card with no candidate: the one of the product (country-choice.js readCountries, the definition the judges were given), so what is
// measured is what runs. Its answers by card id are what "product AND the AI" is compared with
const run = async () => {
    const cards = read('dataset.json');
    const usage = newUsage();
    const read_ = await readCountries(cards.map(card => ({titles: [card.title, card.titleTranslation].filter(Boolean), text: card.text})), usage);
    write('out-ai.json', Object.fromEntries([...read_].map(([at, list]) => [cards[at].id, list])));
    console.log(`${read_.size}/${cards.length} cards answered, tokens ${JSON.stringify(usage)}`);
};

// The whole pipeline of a briefing run again on the same cards (namesAndCountriesOfCards, as briefing-service.js gives it its cards: the titles of the articles, the
// sentences of the card in its language, the sites): what the product shows today, and what the reading of the AI took off (bench/data/countries/out-e2e.json).
// Read only. The names are read again from the database as it is now (a relink not yet run changes nothing here)
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const e2e = async () => {
    const cards = read('dataset.json');
    const briefings = await prisma.$queryRawUnsafe('SELECT id, items FROM briefings WHERE id = ANY($1::int[])', [...new Set(cards.map(card => card.briefing))]);
    const itemOf = new Map(briefings.flatMap(briefing => (briefing.items ?? []).map(item => [`${briefing.id}:${item.storyId}`, item])));
    const given = [];
    for (const card of cards) {
        const item = itemOf.get(`${card.briefing}:${card.storyId}`);
        if (!item?.articles?.length) { console.log(`[${card.id}] no item to rebuild: left out`); continue; }
        const urls = [item.lead?.url, ...item.articles.map(article => article.url)].filter(Boolean);
        const ids = (await prisma.$queryRawUnsafe('SELECT id FROM articles WHERE link = ANY($1::text[])', urls)).map(row => row.id);
        given.push({id: card.id, card: {storyId: item.storyId, ids, media: item.corroboration?.mediaNames ?? [], topic: item.topic ?? null,
            titles: [...new Set(item.articles.map(article => article.title).filter(Boolean))], title: item.title,
            text: [item.digest, item.summary, item.points].flat().filter(Boolean).join('\n'), language: item.language ?? null, sites: urls.map(hostOf)}});
    }
    const {namesAndCountriesOfCards} = await import('../../services/utils/card-names.js');
    const usage = newUsage();
    const out = {};
    for (let i = 0; i < given.length; i += 25) {
        const found = await namesAndCountriesOfCards(given.slice(i, i + 25).map(one => one.card), {usage});
        for (const one of given.slice(i, i + 25)) {
            const result = found.get(one.card.storyId);
            if (result) out[one.id] = {countries: result.countries, decided: result.decided, dropped: result.dropped, cut: result.cut};
        }
    }
    write('out-e2e.json', out);
    console.log(`${Object.keys(out).length}/${cards.length} cards run again, tokens ${JSON.stringify(usage)}`);
};

const codes = (list) =>[...new Set((Array.isArray(list) ? list : []).map(code => String(code).trim().toUpperCase()).filter(code => /^[A-Z]{2}$/.test(code)))];

// the mention of a country in the text of a card: its name in the languages of the news (Intl), the card's title, its translation and its text
const LOCALES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'tr', 'el', 'sr', 'hr', 'cs', 'hu', 'ro', 'bg', 'sv', 'da', 'fi', 'fa', 'ja', 'zh', 'ko'];
const mentioned = (card, code) => {
    const text = `${card.title}. ${card.titleTranslation ?? ''}. ${card.text}`.toLowerCase();
    return LOCALES.some(locale => { const name = countryName(code, locale)?.toLowerCase(); return name && name !== code.toLowerCase() && text.includes(name); });
};

const compare = (cards, one, two) => {
    const ai = read('out-ai.json');
    const pct = (x, y) => y === 0 ? '  -  ' : `${(100 * x / y).toFixed(0)}%`.padStart(4);
    const ways = {
        'the product': (card) => codes(card.shown),
        'an AI that reads the card': (card) => ai[card.id] ?? [],
        'product AND the AI (a country both give)': (card) => codes(card.shown).filter(code => (ai[card.id] ?? []).includes(code)),
        'product OR the AI': (card) => [...new Set([...codes(card.shown), ...(ai[card.id] ?? [])])],
        'product, else the AI when it shows none': (card) => codes(card.shown).length > 0 ? codes(card.shown) : (ai[card.id] ?? []),
        'product, a country kept only when the text names it': (card) => codes(card.shown).filter(code => mentioned(card, code)),
        'product kept if the AI agrees, plus the AI where product has none': (card) => codes(card.shown).length > 0 ? codes(card.shown).filter(code => (ai[card.id] ?? []).includes(code)) : (ai[card.id] ?? []),
    };
    // the pipeline run again with the code as it is now (see e2e): before the reading of the AI, and after it (what the product shows)
    if (existsSync(`${DIR}/out-e2e.json`)) {
        const again = read('out-e2e.json');
        ways['RUN AGAIN: the pipeline before the reading of the AI'] = (card) => again[card.id]?.decided ?? codes(card.shown);
        // what the reading kept, before the rule of the cards that name an international body cut them to their first country (cut: what it took off)
        ways['RUN AGAIN: + the reading of the AI'] = (card) => again[card.id] ? [...again[card.id].countries, ...(again[card.id].cut ?? [])] : codes(card.shown);
        ways['RUN AGAIN: + first country only on a card naming a body (now)'] = (card) => again[card.id]?.countries ?? codes(card.shown);
    }
    console.log('\n== ways to decide the countries (judges: both = right, neither = wrong)');
    console.log(`${'way'.padEnd(66)} shown  right  wrong  precision  lenient  found  recall  cards wrong  cards missed`);
    for (const [name, way] of Object.entries(ways)) {
        let shown = 0, right = 0, wrong = 0, sure = 0, found = 0, cardsWrong = 0, cardsMissed = 0, oneJudge = 0;
        for (const card of cards) {
            const a = codes(one[card.id]), b = codes(two[card.id]);
            const both = a.filter(code => b.includes(code));
            const either = new Set([...a, ...b]);
            const set = way(card);
            shown += set.length;
            right += set.filter(code => both.includes(code)).length;
            oneJudge += set.filter(code => either.has(code) && !both.includes(code)).length;
            const bad = set.filter(code => !either.has(code));
            wrong += bad.length;
            if (bad.length > 0) cardsWrong++;
            sure += both.length;
            found += both.filter(code => set.includes(code)).length;
            if (set.length === 0 && both.length > 0) cardsMissed++;
        }
        console.log(`${name.padEnd(66)} ${String(shown).padStart(5)}  ${String(right).padStart(5)}  ${String(wrong).padStart(5)}  ${pct(right, shown)}      ${pct(right + oneJudge, shown)}   ${String(found).padStart(5)}  ${pct(found, sure)}  ${String(cardsWrong).padStart(10)}  ${String(cardsMissed).padStart(12)}`);
    }
    // the countries shown by the product: named by the text or not, right or wrong
    let rightNamed = 0, rightNot = 0, wrongNamed = 0, wrongNot = 0;
    for (const card of cards) {
        const a = codes(one[card.id]), b = codes(two[card.id]);
        for (const code of codes(card.shown)) {
            const isRight = a.includes(code) && b.includes(code), isWrong = !a.includes(code) && !b.includes(code);
            const named = mentioned(card, code);
            if (isRight) { if (named) rightNamed++; else rightNot++; } else if (isWrong) { if (named) wrongNamed++; else wrongNot++; }
        }
    }
    console.log(`\nthe countries the product shows: right and named by the text ${rightNamed}, right and NOT named ${rightNot}; wrong and named ${wrongNamed}, wrong and NOT named ${wrongNot}`);
};

const score = () => {
    const cards = read('dataset.json');
    const labelsOf = (judge) => Object.assign({}, ...['A', 'B'].map(chunk => {
        const file = `${DIR}/labels-${judge}-${chunk}.json`;
        if (!existsSync(file)) throw new Error(`missing: ${file}`);
        return JSON.parse(readFileSync(file, 'utf8'));
    }));
    const one = labelsOf(1), two = labelsOf(2);
    let shownCodes = 0, right = 0, wrong = 0, disputed = 0, sure = 0, found = 0, missedCards = 0, wrongCards = 0, mainRight = 0, mainCards = 0, noneBoth = 0, shownBoth = 0;
    const lines = {wrong: [], missed: [], main: []};
    for (const card of cards) {
        const a = codes(one[card.id]), b = codes(two[card.id]);
        const both = a.filter(code => b.includes(code));
        const either = new Set([...a, ...b]);
        const shown = codes(card.shown);
        for (const code of shown) {
            shownCodes++;
            if (both.includes(code)) right++;
            else if (either.has(code)) disputed++;
            else wrong++;
        }
        sure += both.length;
        found += both.filter(code => shown.includes(code)).length;
        const wrongHere = shown.filter(code => !either.has(code));
        const missedHere = both.filter(code => !shown.includes(code));
        if (both.length === 0 && a.length + b.length === 0) noneBoth++;
        if (shown.length > 0 && both.length === 0 && a.length + b.length === 0) shownBoth++;
        if (wrongHere.length > 0) { wrongCards++; lines.wrong.push(`[${card.id}] shows ${shown.join(',')} (wrong: ${wrongHere.join(',')}; judges ${a.join(',') || '-'} | ${b.join(',') || '-'}) ${(card.titleTranslation ?? card.title).slice(0, 80)} || ${card.names.filter(n => n.qid).map(n => n.name).slice(0, 4).join(', ')}`); }
        if (missedHere.length > 0 && shown.length === 0) { missedCards++; lines.missed.push(`[${card.id}] shows none, judges ${a.join(',') || '-'} | ${b.join(',') || '-'}: ${(card.titleTranslation ?? card.title).slice(0, 90)} || ${card.names.slice(0, 4).map(n => n.name + (n.qid ? '' : '?')).join(', ')}`); }
        if (both.length > 0 && shown.length > 0) { mainCards++; if (both.includes(shown[0])) mainRight++; else lines.main.push(`[${card.id}] main ${shown[0]}, judges ${a.join(',')} | ${b.join(',')}: ${(card.titleTranslation ?? card.title).slice(0, 80)}`); }
    }
    const pct = (x, y) => y === 0 ? '  -  ' : `${(100 * x / y).toFixed(0)}%`;
    console.log(`${cards.length} cards; the product shows a country on ${cards.filter(card => card.shown.length > 0).length} (${pct(cards.filter(card => card.shown.length > 0).length, cards.length)}); both judges name one on ${cards.filter(card => codes(one[card.id]).some(code => codes(two[card.id]).includes(code))).length}`);
    console.log(`the countries shown: ${shownCodes}; right (both judges) ${right} = ${pct(right, shownCodes)}; one judge only ${disputed} = ${pct(disputed, shownCodes)}; wrong (neither) ${wrong} = ${pct(wrong, shownCodes)}`);
    console.log(`what both judges name: ${sure}; found ${found} = ${pct(found, sure)}`);
    console.log(`cards with a wrong country: ${wrongCards} (${pct(wrongCards, cards.length)}); cards with none shown where both judges name one: ${missedCards}; main country right on ${mainRight}/${mainCards} (${pct(mainRight, mainCards)})`);
    console.log(`both judges say none: ${noneBoth} cards; the product shows a country on ${shownBoth} of them`);
    if (existsSync(`${DIR}/out-ai.json`)) compare(cards, one, two);
    for (const [name, list] of Object.entries(lines)) { console.log(`\n-- ${name} (${list.length})`); for (const line of list.slice(0, 14)) console.log(`   ${line}`); }
};

const command = process.argv[2];
try {
    if (command === 'build') await build(Number(process.argv[3] ?? 120), Number(process.argv[4] ?? 0));
    else if (command === 'run') await run();
    else if (command === 'e2e') await e2e();
    else if (command === 'score') score();
    else console.log('node --env-file=.env bench/countries/measure.mjs build [cards] | run | e2e | score');
} finally {
    await prisma.$disconnect();
}
