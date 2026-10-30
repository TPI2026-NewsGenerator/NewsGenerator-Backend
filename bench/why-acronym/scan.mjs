// How often the "why" of a card (the sentence the AI of the selection writes from the title and the description
// only, see selectionPrompt) spells out an acronym that its sources do not spell out: "the Mexican Football
// Federation (FMF)" for a Malagasy federation. Read only: the cards of the briefings of the last N days, the
// description of their lead article, then each "Words of a name (ACRONYM)" of the why is looked for in the title
// and the description: some words, in any language, whose initials spell the acronym.
// node --env-file=.env bench/why-acronym/scan.mjs [days]
import fs from 'node:fs';
import {prisma} from '../../config/db.js';

const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'y', 'e', 'da', 'do', 'di', 'del', 'della', 'and', 'et', 'und', 'van', 'von', 'el', 'al', 'dos', 'das', 'for', 'in', 'on', 'a', 'o', 'en', 'del']);
const strip = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text) => text.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean);
const initialsOf = (list) => list.filter(word => !SMALL.has(strip(word).replace(/['’]$/, ''))).map(word => strip(word)[0]).join('');
// whether some run of 2 to 8 words of the text spells the acronym
export const spelledIn = (acronym, text) => {
    const target = strip(acronym).replace(/[^a-z]/g, '');
    const list = words(text);
    for (let i = 0; i < list.length; i++) {
        for (let size = 2; size <= 8 && i + size <= list.length; size++) {
            if (initialsOf(list.slice(i, i + size)) === target) return true;
        }
    }
    return false;
};
// "Words of a Name (ACR)" in the why: [{acronym, spelled}]
export const expansionsIn = (why) => [...(why ?? '').matchAll(/((?:[\p{Lu}][\p{L}'’.-]*\s+(?:(?:of|the|de|del|da|di|and|for|y|e)\s+)*){1,7}[\p{L}'’.-]+)\s+\(([\p{Lu}]{2,8})\)/gu)].map(match => ({spelled: match[1], acronym: match[2]}));

if (process.argv[1].endsWith('scan.mjs')) {
    const days = Number(process.argv[2]) || 30;
    const rows = await prisma.$queryRawUnsafe(`
        SELECT b.id AS briefing, i->>'storyId' AS story, i->>'title' AS title, i->>'why' AS why, i->'articles'->0->>'link' AS link
        FROM briefings b, jsonb_array_elements(b.items::jsonb) i
        WHERE b.created_at > now() - make_interval(days => $1::int) AND i->>'why' IS NOT NULL`, days);
    const descriptions = new Map((await prisma.$queryRawUnsafe(`SELECT link, description FROM articles WHERE link = ANY($1::text[])`, [...new Set(rows.map(row => row.link).filter(Boolean))])).map(row => [row.link, row.description ?? '']));
    const found = [];
    for (const row of rows) {
        for (const {spelled, acronym} of expansionsIn(row.why)) {
            const source = `${row.title} ${descriptions.get(row.link) ?? ''}`;
            found.push({briefing: row.briefing, story: row.story, acronym, spelled, inSource: spelledIn(acronym, source), why: row.why, title: row.title});
        }
    }
    console.log(`${rows.length} cards of ${days} days; ${found.length} spell an acronym out in their why (${new Set(found.map(f => f.story)).size} stories), ${found.filter(f => !f.inSource).length} not spelled in the title and the description`);
    for (const f of found.filter(f => !f.inSource)) console.log(`  [${f.briefing}] ${f.acronym} = "${f.spelled}" | ${f.title.slice(0, 90)}`);
    fs.writeFileSync(new URL('./scan.json', import.meta.url), JSON.stringify(found, null, 1));
    await prisma.$disconnect();
    process.exit(0);
}
