//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: census.mjs
//  Description: Step 1 of the map of the FIFA presidency (the precision study): the census of EVERY passage of the last days that names a
//               person (the candidate) and a member association or a confederation of FIFA in the same sentence, with or without a word
//               of support or opposition. These are the passages that get labelled (the gold set), so none is left out and no sample
//               is drawn. Two bounds, as measure2.mjs had (bench/federations): "strict" = the association is a name the tagger linked in
//               this article; "loose" = a name found in the text (the false links of the loose bound are the negatives the study needs).
//               One passage per story, with the number of news and of media that wrote it. Read-only.
//
//  node --env-file=.env bench/fifa/census.mjs "Gianni Infantino" infantino 30
//  node --env-file=.env bench/fifa/census.mjs "Kozo Tashima" tashima 30
//

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {prisma} from '../../config/db.js';

const [NAME = 'Gianni Infantino', REGEX = 'infantino', DAYS = '30'] = process.argv.slice(2);
const dataFile = (name) => new URL(`./data/${name}`, import.meta.url);
const FILE = JSON.parse(readFileSync(new URL('../../services/utils/fifa-members.json', import.meta.url), 'utf8'));
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

// who is looked for: the 211 members and the 6 confederations of FIFA (scripts/build-fifa-members.js)
const members = new Map();
for (const m of FILE.members) members.set(m.qid, {qid: m.qid, fifa: m.fifa, level: 'association', country: m.country, name: m.association, acronyms: m.acronyms ?? [], iso: m.iso});
for (const c of FILE.confederations) members.set(c.qid, {qid: c.qid, fifa: c.fifa, level: 'confederation', country: null, name: c.name, acronyms: [c.fifa], iso: null});
const ids = [...members.keys()];
// the person is found in a sentence by the word of the regex (a surname: "infantino", "tashima"), as measure2.mjs did
const subject = norm(REGEX);

const t0 = Date.now();
const news = await prisma.$queryRawUnsafe(`
    SELECT id, title, description, search_text AS text, lang, medium_of(link) AS medium, id_story AS story, link,
           COALESCE(published_at, created_at) AS at
    FROM articles
    WHERE search_text ~* $2 AND COALESCE(published_at, created_at) >= now() - make_interval(days => $1::int)`, Number(DAYS), REGEX);
console.log(`${news.length} news name "${REGEX}" in the last ${DAYS} days (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// the names the tagger linked to a member in each article (strict)
const linked = new Map();
for (let i = 0; i < news.length; i += 2000) {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT am.id_article AS id, m.qid, m.name FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.qid = ANY($2::text[])`, news.slice(i, i + 2000).map(item => item.id), ids);
    for (const row of rows) linked.set(row.id, [...(linked.get(row.id) ?? []), {qid: row.qid, name: row.name}]);
}
// the names of the loose bound: what the tagger linked anywhere, the name of the federation, its acronyms; kept when one member owns it
const owners = new Map();
const addAlias = (name, id) => {
    const key = norm(name);
    if (key.length >= 3) owners.set(key, (owners.get(key) ?? new Set()).add(id));
};
for (const row of await prisma.$queryRawUnsafe(`SELECT name, qid FROM mentions WHERE qid = ANY($1::text[]) AND kind = 'organization'`, ids)) addAlias(row.name, row.qid);
for (const m of members.values()) {
    addAlias(m.name, m.qid);
    for (const acronym of m.acronyms) addAlias(acronym, m.qid);
}
const aliases = [...owners].filter(([, o]) => o.size === 1).map(([key, o]) => ({key, id: [...o][0]})).sort((a, b) => b.key.length - a.key.length);
const isShort = (key) => key.length < 6 && !key.includes(' ');

// every sentence that names the person and a member
const found = new Map();      // article|qid|sentence key -> passage
for (const item of news) {
    const tagged = new Set((linked.get(item.id) ?? []).map(x => x.qid));
    for (const sentence of sentencesOf(item.text)) {
        const small = norm(sentence);
        if (!small.includes(subject)) continue;
        const hits = new Map();   // qid -> {bound, alias}
        for (const {qid: id, name} of linked.get(item.id) ?? []) {
            const key = norm(name);
            if (key.length >= 3 && spanOf(small, key) >= 0 && !hits.has(id)) hits.set(id, {bound: 'strict', alias: key});
        }
        let masked = small;
        for (const {key, id} of aliases) {
            if (isShort(key) && !tagged.has(id)) continue;
            const at = spanOf(masked, key);
            if (at < 0) continue;
            masked = masked.slice(0, at) + ' '.repeat(key.length) + masked.slice(at + key.length);
            if (!hits.has(id)) hits.set(id, {bound: 'loose', alias: key});
        }
        for (const [qid, hit] of hits) {
            const key = `${item.id}|${qid}|${createHash('sha1').update(small).digest('hex').slice(0, 10)}`;
            found.set(key, {item, qid, sentence, small, ...hit, support: SUPPORT.test(small), oppose: OPPOSE.test(small)});
        }
    }
}

// one passage per story: the same sentence of the same association in the news of one story is one passage; the richest one stands for it
const byStory = new Map();
for (const passage of found.values()) {
    const key = `${passage.item.story ?? `a${passage.item.id}`}|${passage.qid}|${passage.small.slice(0, 80)}`;
    const list = byStory.get(key) ?? [];
    list.push(passage);
    byStory.set(key, list);
}
const passages = [];
for (const list of byStory.values()) {
    list.sort((a, b) => (b.bound === 'strict') - (a.bound === 'strict') || String(b.item.description ?? '').length - String(a.item.description ?? '').length);
    const [best] = list;
    const member = members.get(best.qid);
    passages.push({
        id: createHash('sha1').update(`${REGEX}|${best.item.id}|${best.qid}|${best.small}`).digest('hex').slice(0, 12),
        subject: {name: NAME, regex: REGEX},
        member: {qid: member.qid, fifa: member.fifa, level: member.level, country: member.country, name: member.name, acronyms: member.acronyms, iso: member.iso},
        bound: best.bound, matched: best.alias, acronymOnly: isShort(best.alias),
        sentence: best.sentence,
        stanceWords: {support: best.support, oppose: best.oppose},
        article: {
            id: best.item.id, title: best.item.title, description: String(best.item.description ?? '').slice(0, 1500), medium: best.item.medium, lang: best.item.lang,
            date: new Date(best.item.at).toISOString().slice(0, 10), url: best.item.link, story: best.item.story,
        },
        news: new Set(list.map(x => x.item.id)).size,
        media: new Set(list.map(x => x.item.medium)).size,
    });
}
passages.sort((a, b) => a.article.date.localeCompare(b.article.date) || a.member.country?.localeCompare(b.member.country ?? '') || 0);

const count = (list, key) => new Set(list.map(key)).size;
console.log(`\n${passages.length} passages (one per story): ${count(passages, p => p.member.qid)} members/confederations, ${count(passages, p => p.article.medium)} media`);
console.log(`strict ${passages.filter(p => p.bound === 'strict').length}, loose ${passages.filter(p => p.bound === 'loose').length}, with a word of support/opposition ${passages.filter(p => p.stanceWords.support || p.stanceWords.oppose).length}, none ${passages.filter(p => !p.stanceWords.support && !p.stanceWords.oppose).length}, acronym only ${passages.filter(p => p.acronymOnly).length}, confederations ${passages.filter(p => p.member.level === 'confederation').length}`);
const perMember = Object.entries(Object.groupBy(passages, p => p.member.fifa)).map(([code, list]) => [code, list.length]).sort((a, b) => b[1] - a[1]);
console.log('per member (top 25):', perMember.slice(0, 25).map(([code, n]) => `${code} ${n}`).join(', '));
writeFileSync(dataFile(`census-${REGEX}.json`), JSON.stringify({made: new Date().toISOString(), days: Number(DAYS), subject: {name: NAME, regex: REGEX}, passages}, null, 1));
console.log(`written bench/fifa/data/census-${REGEX}.json`);
await prisma.$disconnect();
