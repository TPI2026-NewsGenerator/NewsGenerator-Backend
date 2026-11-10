// One SPARQL call: the items that are members of FIFA (Q253414), their country and chairperson. Saved to
// data/associations-raw.json so Wikidata is asked once
import {writeFileSync} from 'node:fs';
import {wikimediaHeaders} from '../../services/utils/wikidata.js';

const query = `
SELECT ?fa ?faLabel ?country ?countryLabel ?pres ?presLabel ?type ?typeLabel WHERE {
  ?fa wdt:P463 wd:Q253414 .
  OPTIONAL { ?fa wdt:P17 ?country }
  OPTIONAL { ?fa wdt:P488 ?pres }
  OPTIONAL { ?fa wdt:P31 ?type }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
const response = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), {headers: wikimediaHeaders()});
console.log('status', response.status);
if (!response.ok) { console.log((await response.text()).slice(0, 300)); process.exit(1); }
const json = await response.json();
writeFileSync(new URL('./data/associations-raw.json', import.meta.url), JSON.stringify(json.results.bindings));
console.log('rows', json.results.bindings.length);
const qid = (uri) => uri?.value.split('/').pop();
const byFa = new Map();
for (const row of json.results.bindings) {
    const id = qid(row.fa);
    const item = byFa.get(id) ?? {id, label: row.faLabel?.value, countries: new Set(), presidents: new Set(), types: new Set()};
    if (row.country) item.countries.add(row.countryLabel.value);
    if (row.pres) item.presidents.add(row.presLabel.value);
    if (row.type) item.types.add(row.typeLabel.value);
    byFa.set(id, item);
}
console.log('distinct items', byFa.size);
const types = new Map();
for (const item of byFa.values()) for (const t of item.types) types.set(t, (types.get(t) ?? 0) + 1);
console.log([...types].sort((a, b) => b[1] - a[1]).slice(0, 12));
console.log([...byFa.values()].slice(0, 6).map(i => ({...i, countries: [...i.countries], presidents: [...i.presidents], types: [...i.types]})));
