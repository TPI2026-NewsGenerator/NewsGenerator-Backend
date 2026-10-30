// One truth set for the links of names to Wikidata, from the ones judged by hand for each rule (homonyms,
// lone-items, lone-organizations): {kind, key, names, suites, right: [qid], wrong: [qid], country: [qid],
// none: true when no item is right}. Writes truth.json; the card countries of international-people are
// judged per card and stay in their own bench. node bench/link-truth/build.mjs
import fs from 'node:fs';
import {mentionKey} from '../../services/utils/mentions.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const entries = new Map();
const entry = (kind, name, suite) => {
    const key = `${kind}|${mentionKey(name)}`;
    if (!entries.has(key)) entries.set(key, {kind, key: mentionKey(name), names: [], suites: [], right: [], wrong: [], country: [], none: false});
    const found = entries.get(key);
    if (!found.names.includes(name)) found.names.push(name);
    if (!found.suites.includes(suite)) found.suites.push(suite);
    return found;
};
const add = (list, qid) => { if (!list.includes(qid)) list.push(qid); };

// homonyms: the human the name is, null when none of the items is
for (const [name, qid] of Object.entries(read('../homonyms/truth.json'))) {
    const found = entry('person', name, 'homonyms');
    if (qid) add(found.right, qid); else found.none = true;
}
// judged again (20.10.2026): the titles of Luis de la Fuente (Carvajal "sends a message to", the Spanish team)
// are the coach of Spain, Q3840425, who was left as none for its Mexican namesake
Object.assign(entry('person', 'Luis de la Fuente', 'homonyms'), {none: false, right: ['Q3840425']});
// lone-items: is the one item called so the person (true), another (false), "?" unsure
const lone = [...read('../lone-items/results.json'), ...read('../lone-items/results-zero.json'), ...read('../lone-items/results-named.json')];
for (const [name, verdict] of Object.entries(read('../lone-items/truth.json'))) {
    const row = lone.find(item => item.name === name);
    if (!row || typeof verdict !== 'boolean') continue;
    add(verdict ? entry('person', name, 'lone-items').right : entry('person', name, 'lone-items').wrong, row.qid);
}
// lone-organizations: per item true, false or "country" (it is the country, the body's own)
for (const [name, items] of Object.entries(read('../lone-organizations/truth.json'))) {
    const found = entry('organization', name, 'lone-organizations');
    for (const [qid, verdict] of Object.entries(items)) add(verdict === true ? found.right : verdict === 'country' ? found.country : found.wrong, qid);
}
const all = [...entries.values()];
fs.writeFileSync(new URL('./truth.json', import.meta.url), JSON.stringify(all, null, 1));
console.log(`${all.length} names: ${['homonyms', 'lone-items', 'lone-organizations'].map(suite => `${suite} ${all.filter(e => e.suites.includes(suite)).length}`).join(', ')}`);
