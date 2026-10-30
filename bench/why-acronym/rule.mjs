// The selection prompt (the one that writes "why") on the stories of scan.json whose why spelled an acronym out, as
// it is and with a rule added that keeps an acronym as written unless its sources spell it out; the stories all in
// one prompt, with the profile of the briefing they were shown in, N times each. Counts the whys that spell an
// acronym out and the ones that do it without the title nor the description spelling it.
// node --env-file=.env bench/why-acronym/rule.mjs [runs]
import fs from 'node:fs';
import {prisma} from '../../config/db.js';
import {selectionPrompt, normalizeSelection} from '../../services/utils/profile-ai.js';
import {ollamaJson} from '../../services/utils/ollama.js';
import {expansionsIn, spelledIn} from './scan.mjs';

const RULES = {
    base: '',
    rule: `Ne développe pas un sigle ou une abréviation (FMF, FPF, EFC...) que ce titre et cette description ne développent pas : garde-le tel quel.\n`,
};
const runs = Number(process.argv[2]) || 5;
const found = JSON.parse(fs.readFileSync(new URL('./scan.json', import.meta.url), 'utf8'));
const stories = [...new Set(found.map(f => f.story))];

const candidates = [];
let profileText = null;
for (const story of stories) {
    const rows = await prisma.$queryRawUnsafe(`SELECT title, description FROM articles WHERE id_story = $1::int ORDER BY published_at DESC LIMIT 6`, story);
    if (rows.length === 0) continue;
    const lead = found.find(f => f.story === story);
    // the lead is the one the card was titled with
    const first = rows.find(row => row.title === lead.title) ?? rows[0];
    candidates.push({id: story, title: first.title, description: (first.description ?? '').slice(0, 300), others: [...new Set(rows.filter(row => row !== first).map(row => row.title))].slice(0, 3), media: 1, trusted: false});
    if (!profileText) {
        const [row] = await prisma.$queryRawUnsafe(`SELECT p.text FROM briefings b JOIN user_profiles p ON p.id = b.id_profile WHERE b.id = $1 LIMIT 1`, lead.briefing);
        profileText = row?.text ?? null;
    }
}
console.log(`${candidates.length} stories`);
const result = {};
for (const [label, rule] of Object.entries(RULES)) {
    let spelled = 0, unverified = 0, whys = 0;
    const examples = [];
    for (let run = 0; run < runs; run++) {
        let prompt = selectionPrompt(profileText, candidates, {liked: [], refused: []}, [], false, 10, 'en');
        if (rule) prompt = prompt.replace('Réponds uniquement en JSON', `${rule}Réponds uniquement en JSON`);
        let answer;
        try { answer = await ollamaJson(prompt, {}, {think: false}); } catch (err) { console.log(`  ${label} run ${run + 1}: ${err.message}`); continue; }
        for (const item of normalizeSelection(answer, candidates.map(c => String(c.id)), 10)) {
            const candidate = candidates.find(c => String(c.id) === item.id);
            whys++;
            for (const {acronym, spelled: words} of expansionsIn(item.why)) {
                spelled++;
                const inSource = spelledIn(acronym, `${candidate.title} ${candidate.description} ${candidate.others.join(' ')}`);
                if (!inSource) { unverified++; examples.push(`${acronym} = ${words} | ${candidate.title.slice(0, 70)}`); }
            }
        }
    }
    result[label] = {whys, spelled, unverified, examples: [...new Set(examples)]};
    console.log(`${label}: ${whys} whys, ${spelled} spell an acronym out, ${unverified} not spelled in their sources`);
    for (const example of result[label].examples) console.log(`    ${example}`);
}
fs.writeFileSync(new URL('./rule.json', import.meta.url), JSON.stringify(result, null, 1));
await prisma.$disconnect();
process.exit(0);
