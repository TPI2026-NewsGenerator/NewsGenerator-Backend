//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-passages.js
//  Description: The passages of the news to read for the map of the FIFA presidency: every sentence that names a person (a candidate) and a
//               member association or a confederation of FIFA (fifa-members.json). Two bounds, as in the census of the measure
//               (bench/fifa/census.mjs): "strict" = the association is a name the tagger linked in this article; "loose" = a name
//               found in the text. One passage per story. Kept: every passage of an association; of a confederation only the ones
//               with a word of support or opposition (the others name it beside the person with no stance). Pure: the news and
//               the links come in, the passages go out
//

"use strict"

import {createHash} from 'node:crypto';

export const norm = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const isLetter = /[\p{L}\p{N}]/u;
// where a name is in a text as a whole word, -1 when it is not
export const spanOf = (text, alias) => {
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
export const sentencesOf = (text) => String(text ?? '').split(' | ').flatMap(part => part.split(/(?<=[.!?。！？])\s+/u)).map(sentence => sentence.trim()).filter(Boolean);

// The names to look for: [{key, id}] longest first, a name only one member owns. members: [{qid, name, acronyms}]; mentionNames: [{name, qid}] the
// names the tagger linked to them anywhere in the news
export const aliasIndexOf = ({members, mentionNames = []}) => {
    const owners = new Map();
    const add = (name, id) => {
        const key = norm(name);
        if (key.length >= 3) owners.set(key, (owners.get(key) ?? new Set()).add(id));
    };
    for (const row of mentionNames) add(row.name, row.qid);
    for (const member of members) {
        add(member.association ?? member.name, member.qid);
        for (const acronym of member.acronyms ?? []) add(acronym, member.qid);
    }
    return [...owners].filter(([, set]) => set.size === 1).map(([key, set]) => ({key, id: [...set][0]})).sort((a, b) => b.key.length - a.key.length);
};
export const isShort = (key) => key.length < 6 && !key.includes(' ');

// news: [{id, title, description, text, lang, medium, story, link, at}]; linked: Map(article id -> [{qid, name}]); members: Map(qid -> member row of
// fifa-members.json); terms: the words of the person ("infantino") -> [{hash, member, matched, bound, acronymOnly, sentence, stanceWords, article, news, media}]
export const passagesOf = ({news, linked = new Map(), index, members, terms}) => {
    const words = terms.map(norm).filter(Boolean);
    const found = new Map();
    for (const item of news) {
        const tagged = new Set((linked.get(item.id) ?? []).map(x => x.qid));
        for (const sentence of sentencesOf(item.text ?? `${item.title} | ${item.description ?? ''}`)) {
            const small = norm(sentence);
            if (!words.some(word => spanOf(small, word) >= 0)) continue;
            const hits = new Map();
            for (const {qid, name} of linked.get(item.id) ?? []) {
                const key = norm(name);
                if (key.length >= 3 && members.has(qid) && spanOf(small, key) >= 0 && !hits.has(qid)) hits.set(qid, {bound: 'strict', alias: key});
            }
            let masked = small;
            for (const {key, id} of index) {
                if (isShort(key) && !tagged.has(id)) continue;
                const at = spanOf(masked, key);
                if (at < 0) continue;
                masked = masked.slice(0, at) + ' '.repeat(key.length) + masked.slice(at + key.length);
                if (!hits.has(id)) hits.set(id, {bound: 'loose', alias: key});
            }
            for (const [qid, hit] of hits) {
                const member = members.get(qid);
                const stanceWords = {support: SUPPORT.test(small), oppose: OPPOSE.test(small)};
                // a confederation named beside the person with no stance is no passage
                if (member.level === 'confederation' && !stanceWords.support && !stanceWords.oppose) continue;
                found.set(`${item.id}|${qid}|${norm(sentence)}`, {item, qid, member, sentence, small, ...hit, stanceWords});
            }
        }
    }
    // the same sentence of the same member in the news of one story, or in other stories (an agency paragraph), is one passage
    const merged = new Map();
    for (const passage of found.values()) {
        const key = `${passage.qid}|${passage.small}`;
        const list = merged.get(key) ?? [];
        list.push(passage);
        merged.set(key, list);
    }
    return [...merged.values()].map(list => {
        list.sort((a, b) => (b.bound === 'strict') - (a.bound === 'strict') || String(b.item.description ?? '').length - String(a.item.description ?? '').length);
        const [best] = list;
        return {
            hash: createHash('sha1').update(`${best.qid}|${best.small}`).digest('hex').slice(0, 16),
            member: best.member, matched: best.alias, bound: best.bound, acronymOnly: isShort(best.alias),
            sentence: best.sentence, stanceWords: best.stanceWords,
            article: {id: best.item.id, title: best.item.title, description: String(best.item.description ?? '').slice(0, 1500), medium: best.item.medium, lang: best.item.lang,
                date: new Date(best.item.at).toISOString().slice(0, 10), url: best.item.link, story: best.item.story ?? null},
            news: new Set(list.map(x => x.item.id)).size,
            media: new Set(list.map(x => x.item.medium)).size,
        };
    });
};
