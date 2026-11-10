// Methods for the age gate (friend's point 6, 10.11.2026), tried on the 40 stories of bench/data/old-news-pack.json against the ratings made before
// (bench/data/old-news-labels.json: S stale, F fresh, U unsure, left out). A method says for each story whether to DROP it (it tells an old fact).
//   node --env-file=.env bench/old-news-methods.mjs <method> [runs=1]
// methods: age (drop when anything was published before the window: the rule without the AI), v1 (the AI asked whether the headline is a
// new fact of the window), v2 (the same, told to drop when in doubt)
import process from 'node:process';
import {readFileSync, writeFileSync} from 'node:fs';
import {ollamaJson} from '../services/utils/ollama.js';

const method = process.argv[2] ?? 'age';
const runs = Number(process.argv[3] ?? 1);
// PACK=2: the second set, rated before this method was run on it
const suffix = process.env.PACK === '2' ? '2' : '';
const pack = JSON.parse(readFileSync(`bench/data/old-news-pack${suffix}.json`, 'utf8'));
const {labels} = JSON.parse(readFileSync(`bench/data/old-news-labels${suffix}.json`, 'utf8'));

const ago = (days) => days >= 1 ? `${Math.round(days * 10) / 10} days ago` : `${Math.max(1, Math.round(days * 24))} hours ago`;
const line = (row) => `- ${ago(row.age)}: ${row.title}`;
const span = (hours) => hours > 24 ? `${hours / 24} days` : '24 hours';

const prompt = (stories, hours, doubt) => `A reader gets a daily news briefing of the last ${span(hours)}. For each story: the headline the reader sees, what the media had already published BEFORE those ${span(hours)} (the earlier coverage), then what they published during them.

${stories.map(story => `[${story.n}] Headline: "${story.title}"
Earlier coverage:
${story.before.map(line).join('\n')}
During the last ${span(hours)}:
${story.within.map(line).join('\n')}`).join('\n\n')}

For each story, say whether the fact its headline tells is NEW in the last ${span(hours)}: it happened, was announced, decided or revealed during them (a result, a new step, a new statement, a person or an organisation taking a stand).
It is OLD when that fact was already in the earlier coverage and the news of the last ${span(hours)} only tell it again: other media picking it up late, a reminder, a recap, an analysis or an opinion on it, a reaction to something already known, or a preview of an event that has been played since.
${method === 'v3' ? NEW_EVENTS : ''}
${doubt ? 'When in doubt, it is old: the reader does not want to read the same news twice.' : 'When in doubt, it is new: a story must not be lost.'}
Answer in JSON only: {"stories": [{"id": "...", "earlier": "the earlier fact it repeats, in a few words, or null", "old": true or false}]}`;

// what is new although the earlier coverage was about the same affair
const NEW_EVENTS = 'It is NEW when it is the event itself after its announcement or its preview (the match played, the visit made, the vote held, the burning after the plan to burn), or a step further in the same affair (a semi-final won, then the final reached; a candidate then his programme; a decision taken after the talks).';

// the news before the window start by this margin only are the earlier coverage: a fact told 26 hours ago is not older than the 24 hours of a briefing
const MARGIN = Number(process.env.MARGIN ?? 0);
for (const story of pack) story.before = story.before.filter(row => row.age > story.hours / 24 + MARGIN);
const asked = pack.filter(story => story.before.length > 0);
const decisions = new Map();
for (let run = 0; run < runs; run++) {
    const dropped = new Set();
    if (method === 'age') asked.forEach(story => dropped.add(story.n));
    else {
        // the briefings of one window together, as the briefing asks them
        for (const hours of [...new Set(asked.map(story => story.hours))]) {
            const group = asked.filter(story => story.hours === hours);
            const answer = await ollamaJson(prompt(group, hours, (method === 'v2' || method === 'v3')), null, {think: process.env.THINK === '1'});
            for (const item of Array.isArray(answer?.stories) ? answer.stories : []) {
                const n = Number(String(item?.id ?? '').replace(/\D/g, ''));
                if (group.some(story => story.n === n) && item.old === true) {
                    dropped.add(n);
                    decisions.set(n, item.earlier);
                }
            }
        }
    }
    for (const story of pack) decisions.set(`run${run}:${story.n}`, dropped.has(story.n));
}

// a story dropped in at least half of the runs is dropped
const drops = (story) => {
    const count = Array.from({length: runs}, (_, run) => decisions.get(`run${run}:${story.n}`)).filter(Boolean).length;
    return count * 2 >= runs && count > 0;
};
const rated = pack.filter(story => labels[story.n] === 'S' || labels[story.n] === 'F');
const stale = rated.filter(story => labels[story.n] === 'S');
const fresh = rated.filter(story => labels[story.n] === 'F');
const caught = stale.filter(drops);
const lost = fresh.filter(drops);
const pct = (a, b) => b === 0 ? '-' : `${Math.round(100 * a / b)}%`;
console.log(`${method} x${runs}: asked ${asked.length} of ${pack.length}; stale caught ${caught.length}/${stale.length} (${pct(caught.length, stale.length)}), fresh lost ${lost.length}/${fresh.length} (${pct(lost.length, fresh.length)}), precision of the drops ${pct(caught.length, caught.length + lost.length)}`);
console.log('  stale not caught:', stale.filter(story => !drops(story)).map(story => story.n).join(' '));
console.log('  fresh lost:      ', lost.map(story => story.n).join(' '));
console.log('  unsure dropped:  ', pack.filter(story => labels[story.n] === 'U' && drops(story)).map(story => story.n).join(' '));
writeFileSync(`bench/data/old-news-run${suffix}-${method}.json`, JSON.stringify(pack.map(story => ({n: story.n, label: labels[story.n], dropped: drops(story), earlier: decisions.get(story.n) ?? null})), null, 1));
