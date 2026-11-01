// The titles written in another alphabet than the Latin one, of the cards of the last 30 days, translated again
// with the spelling of their card told to the AI (see services/utils/spellings.js), against the translation
// the briefing gave them: how many have a name spelled otherwise than in the translated text of the same card
// (a consonant off: "Frapar" for "Frappart"). Reads the database, asks the AI; writes nothing.
//   node --env-file=.env bench/spellings-replay.mjs [cards, 60] [repeats of the Frappart title, 5]
import pg from 'pg';
import {translateTexts} from '../services/utils/extract.js';
import {alignNames, namesIn} from '../services/utils/spellings.js';
import {readerLanguage, writtenIn} from '../services/utils/language.js';

const LIMIT = Number(process.argv[2] ?? 60);
const REPEATS = Number(process.argv[3] ?? 5);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`
    SELECT b.id, p.languages, item FROM briefings b
    JOIN user_profiles p ON p.id = b.id_profile, jsonb_array_elements(b.items) item
    WHERE b.created_at > now() - interval '30 days' AND item->>'titleTranslation' IS NOT NULL
      AND item->>'title' ~ '[\\u0370-\\u03FF\\u0400-\\u04FF\\u0600-\\u06FF\\u0590-\\u05FF\\u4E00-\\u9FFF\\u0E00-\\u0E7F]'
    ORDER BY b.created_at DESC`);
await client.end();

// one card once (the same title in several briefings), the ones with a translated text to compare to
const seen = new Set();
const cards = rows.flatMap(({languages, item}) => {
    const body = [item.translation, item.pointsTranslation, item.digestTranslation].filter(Boolean).join('\n');
    if (!body || seen.has(item.title)) return [];
    seen.add(item.title);
    return [{title: item.title, stored: item.titleTranslation, names: namesIn(body), from: writtenIn(item.language), to: writtenIn(readerLanguage({languages}))}];
}).filter(card => card.from && card.to).slice(0, LIMIT);

// a title is off when putting its names right changes it
const off = (translation, card) => alignNames(translation, card.names, card.title) !== translation;
const report = (label, translations, cards) => {
    const bad = cards.filter((card, i) => translations[i] && off(translations[i], card));
    console.log(`${label}: ${bad.length} of ${cards.filter((card, i) => translations[i]).length} titles with a name spelled off`);
    for (const card of bad.slice(0, 8)) console.log(`   ${card.title.slice(0, 60)}  ->  ${translations[cards.indexOf(card)]?.slice(0, 80)}`);
};

console.log(`${cards.length} cards, ${new Set(cards.map(card => card.to)).size} reader languages`);
report('the briefings (stored)', cards.map(card => card.stored), cards);

// again, asked as the briefing does now: the names of the card told to the AI, by reader language
const again = new Array(cards.length).fill(null);
for (const to of new Set(cards.map(card => card.to))) {
    const part = cards.map((card, i) => ({card, i})).filter(({card}) => card.to === to);
    for (let k = 0; k < part.length; k += 10) {
        const batch = part.slice(k, k + 10);
        const answer = await translateTexts(batch.map(({card}) => ({text: card.title, from: card.from, names: card.names})), to);
        batch.forEach(({i}, j) => { again[i] = answer[j]; });
    }
}
report('replayed, names told, before the check of the spelling', again, cards);
console.log(`replayed, after the check: ${cards.filter((card, i) => again[i] && off(alignNames(again[i], card.names, card.title), card)).length} off`);

// the title of the card of 27.10.2026, translated several times: it came out "Frapar" and "Frappart"
const frappart = cards.find(card => card.title.includes('Φραπάρ')) ?? {
    title: 'Θεσσαλονίκη: Σεμινάριο γυναικείας διαιτησίας με τη Φραπάρ της UEFA', from: 'Greek', to: 'English'};
for (const [label, names] of [['no names told', []], ['the names of the text told', ['Stéphanie Frappart', 'Stéphane Lannoy', 'Thessaloniki', 'UEFA']]]) {
    const answers = [];
    for (let i = 0; i < REPEATS; i++) answers.push((await translateTexts([{text: frappart.title, from: frappart.from, to: frappart.to, names}], frappart.to ?? 'English'))[0]);
    console.log(`Frappart title, ${label}:`);
    answers.forEach(answer => console.log(`   ${answer}`));
}
process.exit(0);
