// the names the rule of 5 links and the one of 10 does not, with their two first namesakes
import fs from 'node:fs';
const results = [...JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url))), ...JSON.parse(fs.readFileSync(new URL('./results-named.json', import.meta.url)))];
const sites = JSON.parse(fs.readFileSync(new URL('./sites.json', import.meta.url)));
const top2 = (e) => [...e.humans].sort((a, b) => b.links - a.links).slice(0, 2).map(h => `${h.links} ${h.description ?? ''}`.slice(0, 50));
for (const e of results.filter(e => e.humans?.length)) {
    const [first, second] = [...e.humans].sort((a, b) => b.links - a.links);
    const ahead = first.links >= 3 * (second?.links ?? 0);
    if (ahead && first.links >= 5 && first.links < 10) console.log(e.name, `(${e.news} news, top site ${(sites[e.name]?.share ?? 0).toFixed(2)})`, top2(e).join(' | '));
}
