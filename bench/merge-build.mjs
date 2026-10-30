// builds data/merge/lists.json from lists-src.json (my labels) and pairs-raw.json (the stories)
import fs from 'node:fs';
const dir = new URL('./data/merge/', import.meta.url);
const pairs = JSON.parse(fs.readFileSync(new URL('pairs-raw.json', dir), 'utf8'));
const src = JSON.parse(fs.readFileSync(new URL('lists-src.json', dir), 'utf8'));
const story = (ref) => {
    const pair = pairs[Number(ref.slice(0, -1))], a = ref.endsWith('A');
    return {id: String(a ? pair.a : pair.b), title: a ? pair.ta : pair.tb, description: (a ? pair.da : pair.db) ?? ''};
};
// a fixed shuffle, so that two stories of one fact are rarely next to each other
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const lists = src.lists.map(list => {
    const fact = new Map(list.facts.flatMap((refs, i) => refs.map(ref => [ref, i])));
    const all = list.facts.flat();
    if (new Set(all).size !== all.length) throw new Error(`${list.name}: a ref twice`);
    for (const ref of [...list.shown, ...list.maybe.flat()]) if (!fact.has(ref)) throw new Error(`${list.name}: ${ref} has no fact`);
    const today = all.filter(ref => !list.shown.includes(ref)).sort(() => random() - 0.5);
    const ids = new Map([...list.shown, ...today].map(ref => [ref, story(ref).id]));
    if (new Set(ids.values()).size !== ids.size) throw new Error(`${list.name}: one story under two refs`);
    return {
        name: list.name,
        shown: list.shown.map(story),
        stories: today.map(story),
        fact: Object.fromEntries([...fact].map(([ref, i]) => [ids.get(ref), i])),
        maybe: list.maybe.map(pair => pair.map(ref => ids.get(ref))),
    };
});
fs.writeFileSync(new URL('lists.json', dir), JSON.stringify(lists, null, 1));
for (const list of lists) {
    console.log(`\n== ${list.name}`);
    for (const s of [...list.shown.map(s => ({...s, shown: 1})), ...list.stories]) console.log(`${s.shown ? 'S' : ' '} f${list.fact[s.id]} [${s.id}] ${s.title.slice(0, 100)}`);
}
