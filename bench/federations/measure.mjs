//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: measure.mjs
//  Description: What the news kept could tell of the position of each football association on Infantino:
//               of the news of the 30 days that name him, how many name an association too, in how many
//               associations, in the same sentence, with a word of support or opposition. Read-only.
//
//  node bench/federations/fetch-associations.mjs   (once: the 221 federations of Wikidata)
//  node bench/federations/measure.mjs
//

import {readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';

const DAYS = 30;
const dataFile = (name) => new URL(`./data/${name}`, import.meta.url);

// the text as it is compared: no accents, small letters
const norm = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const isLetter = /[\p{L}\p{N}]/u;
// whether the alias stands alone in the text (not inside a longer word)
const standsAlone = (text, alias) => {
    let from = 0;
    for (;;) {
        const at = text.indexOf(alias, from);
        if (at < 0) return false;
        const before = at === 0 ? '' : text[at - 1];
        const after = text[at + alias.length] ?? '';
        if (!isLetter.test(before) && !isLetter.test(after)) return true;
        from = at + 1;
    }
};

// words of support and of opposition, in the languages of the news (accents removed). Only a way to count
// what the AI would read, nothing is decided with it
const SUPPORT = /\b(support\w*|back(?:s|ed|ing)?\b|endors\w*|behind|re-?elect\w*|second term|third term|fourth term|backing|soutien\w*|soutenir|appui\w*|reelec\w*|apoy\w*|respald\w*|reeleg\w*|sostegno|sostien\w*|appogg\w*|rielez\w*|unterstutz\w*|wiederwahl|steun\w*|herkies\w*|apoi\w*|poparc\w*|podrz\w*|podrsk\w*)/u;
const OPPOSE = /\b(oppos\w*|against|critic\w*|reject\w*|resign\w*|step(?:s|ped)? down|challeng\w*|rival\w*|contre|demission\w*|dimiss\w*|rechaz\w*|dimit\w*|renuncia\w*|ablehn\w*|kritik\w*|rucktritt|tegen\b|afwijz\w*|contra\b|opposit\w*|boycott\w*|boicot\w*)/u;

const sentencesOf = (text) => String(text ?? '').split(' | ').flatMap(part => part.split(/(?<=[.!?。！？])\s+/u)).map(s => s.trim()).filter(Boolean);

let t = Date.now();
const lap = (label) => { console.log(`-- ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`); t = Date.now(); };

// 1. the associations of Wikidata
const rows = JSON.parse(readFileSync(dataFile('associations-raw.json'), 'utf8'));
const qid = (uri) => uri?.value.split('/').pop();
const associations = new Map();
for (const row of rows) {
    if (row.typeLabel?.value !== 'association football federation') continue;
    const id = qid(row.fa);
    const item = associations.get(id) ?? {id, label: row.faLabel?.value, country: new Set(), presidents: new Set()};
    if (row.country) item.country.add(row.countryLabel.value);
    if (row.pres) item.presidents.add(row.presLabel.value);
    associations.set(id, item);
}
const ids = [...associations.keys()];
console.log('associations of Wikidata (type association football federation):', ids.length);

// 2. the names the tagger linked to them: aliases (organisations only), and the presidents' names
const linked = await prisma.$queryRawUnsafe(`SELECT key, name, kind, qid, seen FROM mentions WHERE qid = ANY($1::text[])`, ids);
const aliasOwners = new Map();     // alias key -> Set of qids
const addAlias = (key, id) => {
    if (key.length < 3) return;
    aliasOwners.set(key, (aliasOwners.get(key) ?? new Set()).add(id));
};
for (const m of linked) if (m.kind === 'organization') addAlias(norm(m.name), m.qid);
for (const item of associations.values()) {
    addAlias(norm(item.label), item.id);
    for (const p of item.presidents) if (p.includes(' ')) addAlias(norm(p), item.id);    // a full name only
}
// an alias of two associations tells nothing (LFF of Latvia and of Lithuania)
const aliases = [...aliasOwners].filter(([, owners]) => owners.size === 1).map(([key, owners]) => [key, [...owners][0]]);
console.log('names linked to associations:', linked.length, '-> usable aliases:', aliases.length, '(dropped as ambiguous:', aliasOwners.size - aliases.length, ')');
lap('aliases');

// 3. the news of the 30 days naming Infantino
const news = await prisma.$queryRawUnsafe(`
    SELECT id, search_text AS text, lang, medium_of(link) AS medium, id_story AS story,
           COALESCE(published_at, created_at) AS at
    FROM articles
    WHERE search_text ~* 'infantino' AND COALESCE(published_at, created_at) >= now() - make_interval(days => $1::int)`, DAYS);
console.log('news naming Infantino:', news.length);
lap('infantino news');

// the associations the tagger linked in those news
const tagged = new Map();           // article id -> Set of qids
for (let i = 0; i < news.length; i += 2000) {
    const part = news.slice(i, i + 2000).map(item => item.id);
    const linkedRows = await prisma.$queryRawUnsafe(`
        SELECT am.id_article AS id, m.qid FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.qid = ANY($2::text[])`, part, ids);
    for (const r of linkedRows) tagged.set(r.id, (tagged.get(r.id) ?? new Set()).add(r.qid));
}
lap('tagger links');

// 4. per news: which associations, in the same sentence as Infantino or not, with which words
const signals = [];                 // {qid, news, kind: 'tag'|'text'|'sentence', stance, sentence}
for (const item of news) {
    const text = norm(item.text);
    const found = new Map();        // qid -> {tag, text, sentence, support, oppose, sentenceText}
    const note = (id) => found.get(id) ?? found.set(id, {tag: false, text: false, sentence: false, support: false, oppose: false, sentenceText: null}).get(id);
    for (const id of tagged.get(item.id) ?? []) note(id).tag = true;
    for (const [alias, id] of aliases) if (text.includes(alias) && standsAlone(text, alias)) note(id).text = true;
    if (found.size === 0) continue;
    const sentences = sentencesOf(item.text);
    for (const sentence of sentences) {
        const small = norm(sentence);
        if (!small.includes('infantino')) continue;
        for (const [alias, id] of aliases) {
            if (!found.has(id) || !small.includes(alias) || !standsAlone(small, alias)) continue;
            const entry = found.get(id);
            entry.sentence = true;
            entry.support ||= SUPPORT.test(small);
            entry.oppose ||= OPPOSE.test(small);
            entry.sentenceText ??= sentence;
            if (SUPPORT.test(small) || OPPOSE.test(small)) entry.sentenceText = sentence;
        }
    }
    for (const [id, entry] of found) signals.push({qid: id, id: item.id, story: item.story, medium: item.medium, lang: item.lang, at: item.at, ...entry});
}
lap('matching');

// 5. numbers
const count = (list, key = (s) => s.qid) => new Set(list.map(key)).size;
const withTag = signals.filter(s => s.tag || s.text);
const inSentence = signals.filter(s => s.sentence);
const stanceWords = inSentence.filter(s => s.support || s.oppose);
console.log('\n=== News naming Infantino:', news.length, 'in', count(news, n => n.medium), 'media');
console.log('news also naming an association (tag or name in the text):', count(withTag, s => s.id), ' -> associations:', count(withTag));
console.log('news with the association in the SAME sentence as Infantino:', count(inSentence, s => s.id), ' -> associations:', count(inSentence));
console.log('  ...with a word of support or opposition:', count(stanceWords, s => s.id), ' -> associations:', count(stanceWords));
const storiesOf = (list) => count(list, s => s.story ?? `a${s.id}`);
console.log('stories (one fact told by several media) in the same-sentence case:', storiesOf(inSentence), ' with stance words:', storiesOf(stanceWords));

// per association
const per = new Map();
for (const s of signals) {
    const a = per.get(s.qid) ?? {qid: s.qid, label: associations.get(s.qid)?.label, country: [...associations.get(s.qid).country].join('/'), news: new Set(), sentence: new Set(), stance: new Set(), media: new Set(), days: new Set(), stanceDays: new Set(), stories: new Set()};
    a.news.add(s.id);
    if (s.sentence) { a.sentence.add(s.id); a.media.add(s.medium); a.days.add(new Date(s.at).toISOString().slice(0, 10)); a.stories.add(s.story ?? `a${s.id}`); }
    if (s.sentence && (s.support || s.oppose)) { a.stance.add(s.id); a.stanceDays.add(new Date(s.at).toISOString().slice(0, 10)); }
    per.set(s.qid, a);
}
const table = [...per.values()].map(a => ({qid: a.qid, association: a.label, country: a.country, news: a.news.size, sameSentence: a.sentence.size, stories: a.stories.size, withStance: a.stance.size, media: a.media.size, days: a.days.size, stanceDays: a.stanceDays.size}))
    .sort((a, b) => b.withStance - a.withStance || b.sameSentence - a.sameSentence);
console.log('\nTop 25 associations (news in the same sentence, with stance words):');
console.table(table.slice(0, 25));
const bucket = (n, test) => table.filter(test).length;
console.log('associations with >=1 same-sentence news:', bucket(0, r => r.sameSentence >= 1),
    '| >=3 stories:', bucket(0, r => r.stories >= 3),
    '| >=1 with stance words:', bucket(0, r => r.withStance >= 1),
    '| stance words on >=2 different days:', bucket(0, r => r.stanceDays >= 2),
    '| >=2 media on the stance news:', bucket(0, r => r.withStance >= 1 && r.media >= 2));

// the languages of the same-sentence news
const langs = new Map();
for (const s of inSentence) langs.set(s.lang ?? '?', (langs.get(s.lang ?? '?') ?? 0) + 1);
console.log('languages of the same-sentence news:', [...langs].sort((a, b) => b[1] - a[1]).slice(0, 10));

writeFileSync(dataFile('measure-result.json'), JSON.stringify({days: DAYS, news: news.length, table}, null, 1));

// a sample to read by eye: one sentence per association, the ones with stance words first, a spread of associations
const sample = [];
const seen = new Set();
for (const s of [...stanceWords].sort(() => 0.5 - Math.random())) {
    if (seen.has(s.qid)) continue;
    seen.add(s.qid);
    sample.push(`[${associations.get(s.qid)?.label} | ${s.lang} | ${s.medium} | ${new Date(s.at).toISOString().slice(0, 10)} | ${s.support ? 'SUPPORT ' : ''}${s.oppose ? 'OPPOSE' : ''}] ${s.sentenceText}`);
    if (sample.length >= 40) break;
}
writeFileSync(dataFile('samples.txt'), sample.join('\n\n'));
console.log('\nsample written:', sample.length, 'sentences ->', 'bench/federations/data/samples.txt');
await prisma.$disconnect();
