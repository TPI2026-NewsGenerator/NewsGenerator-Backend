// What each way to link a name found, against truth.json (judged by hand, review.txt). Right: the item the
// news mean, or none when none is meant (or none was found for an item no way found); wrong: another item;
// lost: none where an item is meant.
// node --env-file=.env bench/wiki-search/score.mjs
import fs from 'node:fs';
import {mentionKey} from '../../services/utils/mentions.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const sample = read('sample.json');
const truthFile = read('truth.json');
const {results, items} = read('results.json');
const byId = new Map(results.map(out => [out.id, out]));

const PLACE_WORDS = /\b(country|sovereign|state|republic|kingdom|territory|region|province|city|town|village|capital|island|continent|municipality|commune|county|district|area|borough|neighbou?rhood|prefecture|canton|peninsula|desert|river|mountain|lake|sea|ocean|bay|strait|airport|port|settlement|urban|metropolitan|parish|archipelago|enclave|department|oblast|governorate|emirate|stadium|arena|bridge|park|castle|prison|ski|section|suburb|road|motorway|venue|palace|base|center|centre|resort|monastery|hill|valley|forest|beach|coast)\b/i;
const DISAMBIGUATION = /disambiguation page|^Wikimedia (list|category|template)/i;

// the item of a way, by its reference "W", "P2", "Q1", "E3"
const refQid = (row, ref) => {
    if (ref === 'W') return row.qid ?? null;
    const list = {P: 'plain', Q: 'quoted', E: 'english'}[ref[0]];
    return byId.get(row.id)?.[list]?.[Number(ref.slice(1)) - 1]?.qid ?? null;
};
const ofKind = (kind, item) => kind === 'person' ? item.human : kind === 'location' ? !item.human && !item.work && (item.place || PLACE_WORDS.test(item.description ?? '')) : !item.human && !item.work;
const good = (row, hit) => {
    if (!hit.qid || hit.disambiguation) return false;
    const item = items[hit.qid];
    return item && ofKind(row.kind, item) && !/^\p{Ll}/u.test(item.label ?? '') && !DISAMBIGUATION.test(item.description ?? '');
};
const close = (row, hit) => {
    const name = mentionKey(row.name);
    const title = mentionKey(hit.title.replace(/\s*\([^)]*\)\s*$/, ''));
    return name === title || title.includes(name) || name.includes(title);
};

// every way: the qid it answers, null for none
const ways = {
    'W  Wikidata, as in production': (row) => row.qid ?? null,
    'A  Wikipedia search, first page (plain)': (row) => byId.get(row.id)?.plain?.[0]?.qid ?? null,
    'B  first page that is no homonyms page': (row) => byId.get(row.id)?.plain?.find(hit => hit.qid && !hit.disambiguation)?.qid ?? null,
    'C  B + the item of the kind of the name': (row) => byId.get(row.id)?.plain?.find(hit => good(row, hit))?.qid ?? null,
    'D  C + the title is the name (qualifier aside)': (row) => byId.get(row.id)?.plain?.find(hit => good(row, hit) && close(row, hit))?.qid ?? null,
    'E  D over plain, quoted, then English': (row) => {
        const out = byId.get(row.id);
        for (const list of [out?.plain, out?.quoted, out?.english]) {
            const hit = (list ?? []).find(hit => good(row, hit) && close(row, hit));
            if (hit) return hit.qid;
        }
        return null;
    },
    'H  first page only, if it passes D': (row) => {
        const hit = byId.get(row.id)?.plain?.[0];
        return hit && good(row, hit) && close(row, hit) ? hit.qid : null;
    },
    'I  H and the quoted search says the same': (row) => {
        const out = byId.get(row.id);
        const hit = out?.plain?.[0];
        return hit && good(row, hit) && close(row, hit) && out.quoted?.[0]?.qid === hit.qid ? hit.qid : null;
    },
    'J  W, else I': (row) => row.qid ?? ways['I  H and the quoted search says the same'](row),
    'K  W, else H': (row) => row.qid ?? ways['H  first page only, if it passes D'](row),
    'L  H, else W': (row) => ways['H  first page only, if it passes D'](row) ?? row.qid ?? null,
    'F  W, else E': (row) => row.qid ?? ways['E  D over plain, quoted, then English'](row),
    'G  E, else W': (row) => ways['E  D over plain, quoted, then English'](row) ?? row.qid ?? null,
};

const judged = sample.map((row, i) => ({row, ref: truthFile[String(i + 1)]})).filter(({ref}) => ref !== 'unsure');
const outcome = (answer, truth) => {
    if (truth === undefined) return null;
    if (truth === null) return answer === null ? 'right' : 'wrong';
    return answer === truth ? 'right' : answer === null ? 'lost' : 'wrong';
};
const rows = judged.map(({row, ref}) => ({row, ref, truth: ref === 'none' || ref === 'missing' ? null : refQid(row, ref), meant: !['none', 'missing'].includes(ref)}));
console.log(`${judged.length} names judged (${sample.length - judged.length} left out as unsure); an item is meant for ${rows.filter(r => r.meant).length}, none for ${rows.filter(r => r.ref === 'none').length}, one exists that no way found for ${rows.filter(r => r.ref === 'missing').length}`);
const kinds = ['all', 'person', 'location', 'organization'];
for (const kind of kinds) {
    const part = rows.filter(r => kind === 'all' || r.row.kind === kind);
    console.log(`\n${kind} (${part.length}; an item is meant for ${part.filter(r => r.meant).length}):`);
    console.log('  way'.padEnd(52), 'right'.padStart(6), 'wrong'.padStart(6), 'lost'.padStart(6), ' linked right/wrong');
    for (const [label, way] of Object.entries(ways)) {
        const tally = {right: 0, wrong: 0, lost: 0, linkedRight: 0};
        for (const r of part) {
            const answer = way(r.row);
            const o = outcome(answer, r.truth);
            tally[o]++;
            if (answer && r.truth === answer) tally.linkedRight++;
        }
        const linked = part.filter(r => way(r.row)).length;
        console.log(`  ${label}`.padEnd(52), String(tally.right).padStart(6), String(tally.wrong).padStart(6), String(tally.lost).padStart(6), `  ${tally.linkedRight}/${linked - tally.linkedRight}`);
    }
}

// node ... score.mjs wrongs: what E links wrongly, and the right links it adds to W
if (process.argv[2] === 'wrongs') {
    const E = ways['E  D over plain, quoted, then English'];
    const label = (qid) => qid ? `${items[qid]?.label ?? qid} (${(items[qid]?.description ?? '').slice(0, 45)})` : 'none';
    console.log('\nE links wrongly:');
    for (const r of rows) {
        const answer = E(r.row);
        if (answer && answer !== r.truth) console.log(`  [${sample.indexOf(r.row) + 1}] ${r.row.kind} "${r.row.name}" (${r.row.lang}) truth=${r.ref}: E -> ${label(answer)}; W -> ${label(r.row.qid)}`);
    }
    console.log('\nE links right where W did not:');
    for (const r of rows) {
        const answer = E(r.row);
        if (answer && answer === r.truth && r.row.qid !== answer) console.log(`  [${sample.indexOf(r.row) + 1}] ${r.row.kind} "${r.row.name}" (${r.row.lang}) -> ${label(answer)}`);
    }
    console.log('\nW links wrongly:');
    for (const r of rows) if (r.row.qid && r.row.qid !== r.truth) console.log(`  [${sample.indexOf(r.row) + 1}] "${r.row.name}" truth=${r.ref}: W -> ${label(r.row.qid)}`);
}
