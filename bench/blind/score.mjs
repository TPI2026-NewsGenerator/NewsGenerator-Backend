// The systems of run.mjs and what the cards showed (the item linked in production) against the judgments of truth.json,
// made before any system ran. Per name: right (the item judged right, or none where none is right), near (an item
// accepted as near), wrong (another item, or an item where none is right), lost (none where one is right).
// A 95% interval (Wilson) on the share of right. node bench/blind/score.mjs
import fs from 'node:fs';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const items = read('./items.json');
const truth = read('./truth.json');
const systems = {production: (item) => item.prodQid};
for (const name of ['plain', 'rich', 'rich2', 'ordered', 'vote']) {
    if (!fs.existsSync(new URL(`./results-${name}.json`, import.meta.url))) continue;
    const results = new Map(read(`./results-${name}.json`).map(r => [r.i, r]));
    systems[name] = (item) => results.get(item.i)?.pick ?? null;
}
const outcome = (item, pick) => {
    const t = truth[item.i];
    if (!pick) return t.right.length > 0 ? 'lost' : 'right';
    if (t.right.includes(pick)) return 'right';
    if (t.near.includes(pick)) return 'near';
    return 'wrong';
};
const wilson = (k, n) => {
    const z = 1.96;
    const p = k / n;
    const d = 1 + z * z / n;
    const centre = (p + z * z / (2 * n)) / d;
    const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return `${(100 * (centre - half)).toFixed(0)}-${(100 * (centre + half)).toFixed(0)}%`;
};
const sets = {
    'all 240': items,
    'without the 7 unsure': items.filter(item => !truth[item.i].unsure),
    'right item among the candidates (171)': items.filter(item => truth[item.i].right.length > 0),
    'none right (69)': items.filter(item => truth[item.i].right.length === 0),
};
for (const [label, set] of Object.entries(sets)) {
    console.log(`\n${label}: ${set.length} names`);
    console.log('system      right  near  wrong  lost   right share (95% interval)');
    for (const [name, pick] of Object.entries(systems)) {
        const t = {right: 0, near: 0, wrong: 0, lost: 0};
        for (const item of set) t[outcome(item, pick(item))]++;
        console.log(`${name.padEnd(11)} ${String(t.right).padStart(5)} ${String(t.near).padStart(5)} ${String(t.wrong).padStart(6)} ${String(t.lost).padStart(5)}   ${(100 * t.right / set.length).toFixed(0)}% (${wilson(t.right, set.length)})`);
    }
}
