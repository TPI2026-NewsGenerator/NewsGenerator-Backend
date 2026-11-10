//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: measure2.mjs
//  Description: measure.mjs corrected after reading its sample by hand (10.11.2026): the confederations are no
//               voters, "Federcalcio francese" was read as the Italian federation, "Football Association of Wales"
//               as the English one, the acronyms NFF/FMF as the wrong country. Two bounds:
//                 strict: only the names the tagger linked to an association IN THIS article
//                 loose:  the names found in the text, longest first, short acronyms only if the tagger linked them
//               Read-only.
//

import {readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {countryNamed} from '../../services/utils/country-names.js';

const DAYS = 30;
const dataFile = (name) => new URL(`./data/${name}`, import.meta.url);
const norm = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const isLetter = /[\p{L}\p{N}]/u;
const spanOf = (text, alias) => {
    let from = 0;
    for (;;) {
        const at = text.indexOf(alias, from);
        if (at < 0) return -1;
        const before = at === 0 ? '' : text[at - 1];
        const after = text[at + alias.length] ?? '';
        if (!isLetter.test(before) && !isLetter.test(after)) return at;
        from = at + 1;
    }
};
const SUPPORT = /\b(support\w*|back(?:s|ed|ing)?\b|endors\w*|behind|re-?elect\w*|second term|third term|fourth term|soutien\w*|soutenir|appui\w*|reelec\w*|apoy\w*|respald\w*|reeleg\w*|sostegno|sostien\w*|appogg\w*|rielez\w*|unterstutz\w*|wiederwahl|steun\w*|herkies\w*|apoi\w*|poparc\w*|podrz\w*|podrsk\w*)/u;
const OPPOSE = /\b(oppos\w*|against|critic\w*|reject\w*|resign\w*|step(?:s|ped)? down|challeng\w*|rival\w*|contre|demission\w*|dimiss\w*|rechaz\w*|dimit\w*|renuncia\w*|ablehn\w*|kritik\w*|rucktritt|tegen\b|afwijz\w*|contra\b|opposit\w*|boycott\w*|boicot\w*)/u;
const sentencesOf = (text) => String(text ?? '').split(' | ').flatMap(part => part.split(/(?<=[.!?。！？])\s+/u)).map(s => s.trim()).filter(Boolean);

// the person the positions are about: node bench/federations/measure2.mjs "kozo tashima" (default infantino)
const SUBJECT = norm(process.argv[2] ?? 'infantino');
const TAG = SUBJECT.replace(/\W+/g, '-');

let t = Date.now();
const lap = (label) => { console.log(`-- ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`); t = Date.now(); };

// 1. the federations of Wikidata, the confederations apart
const rows = JSON.parse(readFileSync(dataFile('associations-raw.json'), 'utf8'));
const qid = (uri) => uri?.value.split('/').pop();
const BLOC = /^(confederation of african|asian football confederation|union of european|oceania football|conmebol|south american football|concacaf|confederation of north)/i;
const members = new Map(), blocs = new Map();
for (const row of rows) {
    if (row.typeLabel?.value !== 'association football federation') continue;
    const id = qid(row.fa);
    const target = BLOC.test(row.faLabel?.value ?? '') ? blocs : members;
    const item = target.get(id) ?? {id, label: row.faLabel?.value, country: new Set()};
    if (row.country) item.country.add(row.countryLabel.value);
    target.set(id, item);
}
const labelOf = (id) => (members.get(id) ?? blocs.get(id))?.label;
const allIds = [...members.keys(), ...blocs.keys()];
console.log('members (candidates for the 211):', members.size, '| confederations/blocs:', blocs.size, [...blocs.values()].map(b => b.label));

// 2. the news naming Infantino, and the names the tagger found in each that it linked to a federation
const news = await prisma.$queryRawUnsafe(`
    SELECT id, search_text AS text, lang, medium_of(link) AS medium, id_story AS story, link,
           COALESCE(published_at, created_at) AS at
    FROM articles
    WHERE search_text ~* $2 AND COALESCE(published_at, created_at) >= now() - make_interval(days => $1::int)`, DAYS, SUBJECT);
const linkedNames = new Map();      // article id -> [{qid, name}]
for (let i = 0; i < news.length; i += 2000) {
    const part = news.slice(i, i + 2000).map(item => item.id);
    const r = await prisma.$queryRawUnsafe(`
        SELECT am.id_article AS id, m.qid, m.name FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.qid = ANY($2::text[])`, part, allIds);
    for (const x of r) linkedNames.set(x.id, [...(linkedNames.get(x.id) ?? []), {qid: x.qid, name: x.name}]);
}
lap(`news naming Infantino: ${news.length}`);

// the aliases of the loose bound: names the tagger linked anywhere, kept when one association only owns them
const mentionRows = await prisma.$queryRawUnsafe(`SELECT name, kind, qid FROM mentions WHERE qid = ANY($1::text[]) AND kind = 'organization'`, allIds);
const owners = new Map();
const addAlias = (name, id) => { const key = norm(name); if (key.length >= 4) owners.set(key, (owners.get(key) ?? new Set()).add(id)); };
for (const m of mentionRows) addAlias(m.name, m.qid);
for (const item of [...members.values(), ...blocs.values()]) addAlias(item.label, item.id);
// "{Country} FA", "{Country} Football Federation": the tagger saw these names without linking them, the country
// is read by countryNamed (country-names.js) and the association is the only one of that country (not GB: four)
const byCountry = new Map();
for (const item of members.values()) for (const label of item.country) {
    const code = countryNamed(label);
    if (code) byCountry.set(code, [...(byCountry.get(code) ?? []), item.id]);
}
const COUNTRY_FA = /^(.+?) (?:FA|FF|football association|football federation|soccer federation|soccer association|football confederation)$/i;
let extra = 0;
const unlinkedNames = new Set();
for (let i = 0; i < news.length; i += 2000) {
    const r = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT m.name FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.kind = 'organization' AND m.qid IS NULL`, news.slice(i, i + 2000).map(x => x.id));
    for (const x of r) unlinkedNames.add(x.name);
}
for (const name of unlinkedNames) {
    const found = COUNTRY_FA.exec(name);
    const code = found && countryNamed(found[1]);
    const ids = code ? byCountry.get(code) : null;
    if (ids?.length === 1 && code !== 'GB') { addAlias(name, ids[0]); extra++; }
}
console.log('extra names "{Country} FA" read from the unlinked ones:', extra);
const aliases = [...owners].filter(([, o]) => o.size === 1).map(([key, o]) => ({key, id: [...o][0]})).sort((a, b) => b.key.length - a.key.length);
const isShort = (key) => key.length < 6 && !key.includes(' ');

// 3. match
const out = [];     // {id(article), qid, bound: 'strict'|'loose', sentence, support, oppose, ...}
for (const item of news) {
    const tagged = new Set((linkedNames.get(item.id) ?? []).map(x => x.qid));
    for (const sentence of sentencesOf(item.text)) {
        const small = norm(sentence);
        if (!small.includes(SUBJECT)) continue;
        const stance = {support: SUPPORT.test(small), oppose: OPPOSE.test(small)};
        // strict: the names the tagger linked in this article
        const strict = new Set();
        for (const {qid: id, name} of linkedNames.get(item.id) ?? []) {
            const key = norm(name);
            if (key.length >= 3 && spanOf(small, key) >= 0) strict.add(id);
        }
        // loose: names in the text, the longest first, each span used once
        let masked = small;
        const loose = new Set();
        for (const {key, id} of aliases) {
            if (isShort(key) && !tagged.has(id)) continue;
            const at = spanOf(masked, key);
            if (at < 0) continue;
            loose.add(id);
            masked = masked.slice(0, at) + ' '.repeat(key.length) + masked.slice(at + key.length);
        }
        for (const id of strict) out.push({article: item.id, qid: id, bound: 'strict', sentence, ...stance, item});
        for (const id of loose) if (!strict.has(id)) out.push({article: item.id, qid: id, bound: 'loose', sentence, ...stance, item});
    }
}
lap('matching');

// 4. numbers, members and blocs apart
const count = (list, key) => new Set(list.map(key)).size;
const report = (name, list) => {
    const stance = list.filter(s => s.support || s.oppose);
    console.log(`${name.padEnd(26)} news ${String(count(list, s => s.article)).padStart(5)} | associations ${String(count(list, s => s.qid)).padStart(3)} | with stance words: news ${String(count(stance, s => s.article)).padStart(4)}, associations ${String(count(stance, s => s.qid)).padStart(3)}, stories ${count(stance, s => s.item.story ?? `a${s.article}`)}`);
};
console.log(`\n=== ${news.length} news name "${SUBJECT}" in ${count(news, n => n.medium)} media (last ${DAYS} days), first ${news.length ? new Date(Math.min(...news.map(n => new Date(n.at)))).toISOString().slice(0, 10) : '-'}`);
const memberOnly = (s) => members.has(s.qid);
report('strict, members', out.filter(s => s.bound === 'strict' && memberOnly(s)));
report('strict+loose, members', out.filter(memberOnly));
report('strict+loose, blocs', out.filter(s => blocs.has(s.qid)));
const newsWithAny = new Set(linkedNames.keys());
console.log('news where the tagger linked a federation or a bloc anywhere in the text:', newsWithAny.size);

// per association (members), strict + loose
const per = new Map();
for (const s of out.filter(memberOnly)) {
    const a = per.get(s.qid) ?? {qid: s.qid, association: labelOf(s.qid), sentence: new Set(), stance: new Set(), stories: new Set(), media: new Set(), stanceDays: new Set(), firstStance: null, lastStance: null};
    a.sentence.add(s.article); a.stories.add(s.item.story ?? `a${s.article}`); a.media.add(s.item.medium);
    if (s.support || s.oppose) {
        a.stance.add(s.article);
        const day = new Date(s.item.at).toISOString().slice(0, 10);
        a.stanceDays.add(day);
        if (!a.firstStance || day < a.firstStance) a.firstStance = day;
        if (!a.lastStance || day > a.lastStance) a.lastStance = day;
    }
    per.set(s.qid, a);
}
const table = [...per.values()].map(a => ({qid: a.qid, association: a.association, news: a.sentence.size, stories: a.stories.size, media: a.media.size, withStance: a.stance.size, stanceDays: a.stanceDays.size, first: a.firstStance, last: a.lastStance}))
    .sort((a, b) => b.withStance - a.withStance || b.news - a.news);
console.log('\nMembers, same sentence as Infantino (strict+loose):');
console.table(table.slice(0, 40));
const n = (test) => table.filter(test).length;
console.log('members with >=1 same-sentence news:', n(r => r.news >= 1),
    '| >=3 stories:', n(r => r.stories >= 3),
    '| >=1 with stance words:', n(r => r.withStance >= 1),
    '| stance on >=2 different days:', n(r => r.stanceDays >= 2),
    '| stance spread over >=7 days:', n(r => r.first && r.last && (new Date(r.last) - new Date(r.first)) >= 7 * 864e5));

// 5. the federations the tagger saw in these news without linking them (what the bounds miss)
const ids = news.map(x => x.id);
const unlinked = new Map();
for (let i = 0; i < ids.length; i += 2000) {
    const r = await prisma.$queryRawUnsafe(`
        SELECT m.name, count(DISTINCT am.id_article)::int AS news FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.kind = 'organization' AND m.qid IS NULL
          AND m.key ~ '(federation|federacion|federacao|federazione|federcalcio|verband|fussball|futbol|football|calcio|futebol|voetbal|soccer|fa$|bond$)'
        GROUP BY m.name`, ids.slice(i, i + 2000));
    for (const x of r) unlinked.set(x.name, (unlinked.get(x.name) ?? 0) + x.news);
}
console.log('\nFederation-looking organisations the tagger saw but could not link, in these news (top 45):');
console.log([...unlinked].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([name, c]) => `${c}\t${name}`).join('\n'));
lap('unlinked');

// 6. samples to read by eye: strict first, members, at most 2 per association, stance words only
const samples = [];
const perCount = new Map();
for (const s of out.filter(x => memberOnly(x) && (x.support || x.oppose)).sort((a, b) => (a.bound === 'strict' ? 0 : 1) - (b.bound === 'strict' ? 0 : 1) || Math.random() - 0.5)) {
    if ((perCount.get(s.qid) ?? 0) >= 2) continue;
    perCount.set(s.qid, (perCount.get(s.qid) ?? 0) + 1);
    samples.push(`[${labelOf(s.qid)} | ${s.bound} | ${s.item.lang} | ${s.item.medium} | ${new Date(s.item.at).toISOString().slice(0, 10)}] ${s.sentence.replace(/\s+/g, ' ')}`);
    if (samples.length >= 60) break;
}
writeFileSync(dataFile(`samples-${TAG}.txt`), samples.join('\n\n'));
console.log('\nsamples written:', samples.length);
writeFileSync(dataFile(`measure-${TAG}.json`), JSON.stringify({days: DAYS, subject: SUBJECT, news: news.length, table}, null, 1));
// the timeline of one association (Japan, the user's example): one sentence per story, by date
for (const [id, file] of SUBJECT === 'infantino' ? [['Q579842', 'timeline-japan.txt'], ['Q154191', 'timeline-germany.txt']] : [['Q579842', `timeline-japan-${TAG}.txt`]]) {
    const seenStory = new Set();
    const lines = out.filter(s => s.qid === id).sort((a, b) => new Date(a.item.at) - new Date(b.item.at))
        .filter(s => { const key = s.item.story ?? `a${s.article}`; if (seenStory.has(key)) return false; seenStory.add(key); return true; })
        .map(s => `${new Date(s.item.at).toISOString().slice(0, 10)} | ${s.item.lang} | ${s.item.medium} | ${s.support ? 'S' : '-'}${s.oppose ? 'O' : '-'} | ${s.sentence.replace(/\s+/g, ' ').slice(0, 420)}`);
    writeFileSync(dataFile(file), lines.join('\n'));
}
await prisma.$disconnect();
