// The acronyms of the football associations of services/utils/football-associations.json as Wikidata has them: the short name (P1813) and the aliases in
// English that look like an acronym. Writes nothing: prints what scripts/build-football-associations.js would keep, and the acronyms two associations share.
//   node --env-file=.env bench/countries/association-acronyms.mjs
import {readFileSync} from 'node:fs';
import {wikimediaHeaders} from '../../services/utils/wikidata.js';

const table = JSON.parse(readFileSync(new URL('../../services/utils/football-associations.json', import.meta.url), 'utf8'));
const ACRONYM = /^[A-Z][A-Za-z0-9]{1,7}$/;
const found = new Map();
for (let i = 0; i < table.length; i += 40) {
    const ids = table.slice(i, i + 40).map(item => item.qid).join('|');
    const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=aliases|claims&languages=en&ids=${ids}`, {headers: wikimediaHeaders()});
    if (!response.ok) { console.error(`HTTP ${response.status}`); process.exit(1); }
    const {entities} = await response.json();
    for (const [qid, entity] of Object.entries(entities)) {
        const short = (entity.claims?.P1813 ?? []).map(claim => claim.mainsnak?.datavalue?.value?.text ?? claim.mainsnak?.datavalue?.value).filter(value => typeof value === 'string');
        const aliases = (entity.aliases?.en ?? []).map(alias => alias.value);
        found.set(qid, [...new Set([...short, ...aliases].filter(value => ACRONYM.test(value)))]);
    }
}
const by = new Map();
for (const item of table) for (const acronym of found.get(item.qid) ?? []) by.set(acronym, [...(by.get(acronym) ?? []), item.name]);
console.log(`${table.length} associations, ${[...found.values()].filter(list => list.length > 0).length} with at least one acronym, ${by.size} acronyms`);
for (const name of ['Football Kenya Federation', 'Turks and Caicos Islands Football Association', 'Jordan Football Association', 'Nigeria Football Federation', 'Algerian Football Federation', 'Royal Spanish Football Federation', 'Japan Football Association', 'The Football Association', 'Irish Football Association', 'Football Association of Ireland']) {
    const item = table.find(one => one.name === name);
    console.log(`  ${name.padEnd(46)} ${JSON.stringify(item ? found.get(item.qid) : 'not in the table')}`);
}
console.log('shared by two associations or more:', [...by].filter(([, names]) => names.length > 1).map(([acronym, names]) => `${acronym} (${names.length})`).join(', ') || 'none');
console.log('all (first 60):', [...by.keys()].slice(0, 60).join(' '));
