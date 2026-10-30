// Read only: two labels a card could carry, measured on the same stories, for reading by hand.
//   "Contesté": a sentence of one of the articles saying someone named denies something. The code finds
//     the sentences with a verb of denial (DENIAL below, five languages), the AI only confirms who
//     denies what, and whether it is the news of the card or a side point.
//   "Version différente": the other articles that tell a point of the news otherwise than the lead,
//     without saying which is right: the AI names the pairs of sentences, the code shows them with
//     their dates (a figure that changed during the day is shown as such, with its hours).
// The stories: the 100 of politics and world news of bench/contradictions-world.json, and the cards of
// the briefings of the last DAYS told by 2 media or more. Written to bench/data/contested-versions.*
//   node --env-file=.env bench/contested-versions.mjs [days]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf} from '../services/utils/extract.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const DAYS = Number(process.argv[2] ?? 14);
const PER_STORY = 8;                // articles read, one per medium
const VERSIONS_OTHERS = 5;          // articles compared with the lead
const SENTENCES = 40;
const usage = {contested: newUsage(), versions: newUsage()};
let failed = 0;

// the verbs and words of a denial; a sentence without one is never read as a denial (the 4 wrong of
// the sample of bench/contradictions-facts.mjs had none)
const DENIAL = new RegExp([
    // en
    String.raw`\bden(y|ies|ied|ying|ial|ials)\b`, String.raw`\brefut`, String.raw`\brebut`, String.raw`\bdisput(e|es|ed|ing)\b`,
    String.raw`\bbaseless\b`, String.raw`\bunfounded\b`, String.raw`\breject(s|ed|ing)?\b.{0,40}\b(claim|accusation|allegation|report|charge)`,
    // fr
    String.raw`\bdément`, String.raw`\bdémenti`, String.raw`\bni(e|ent|ait|aient|é|ée)\b`, String.raw`\bcontest(e|ent|é|ée|ait|aient)\b`,
    String.raw`\brécus`, String.raw`\bréfut`, String.raw`\brejet\w*\b.{0,40}\b(accusation|affirmation|allégation)`, String.raw`\binfondé`, 'sans fondement',
    // es
    String.raw`\bnieg(a|an|o)\b`, String.raw`\bneg(ó|aron|ado)\b`, String.raw`\bdesmient`, String.raw`\bdesmint`, String.raw`\brechaz\w*\b.{0,40}\b(acusaci|afirmaci)`, String.raw`\binfundad`,
    // de
    String.raw`\bdementi`, String.raw`\bbestreit`, String.raw`\bbestritt`, String.raw`\b(weist|wies|wiesen)\b.{0,60}\bzurück`, String.raw`\bhaltlos`,
    // it
    String.raw`\bsmenti`, String.raw`\bneg(a|ano|ato)\b`, String.raw`\brespin\w*\b.{0,40}\baccus`, String.raw`\binfondat`,
].join('|'), 'i');

const askJson = async (prompt, use) => {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await ollamaJson(prompt, use);
        } catch {
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
        }
    }
    failed++;
    return null;
};

// --- the stories
const world = JSON.parse(fs.readFileSync(new URL('./data/contradictions-world.json', import.meta.url), 'utf8'))
    .cardResults.map(card => ({storyId: card.storyId, from: 'world'}));
const rows = await prisma.$queryRawUnsafe(`
    SELECT items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)
    ORDER BY created_at DESC`, DAYS);
const briefing = [];
const seen = new Set(world.map(story => story.storyId));
for (const row of rows) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
        if ((item.corroboration?.media ?? 0) < 2 || seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        briefing.push({storyId: item.storyId, from: 'briefing', cardTitle: item.title, leadUrl: item.lead?.url ?? null});
    }
}

const stories = [];
for (const story of [...world, ...briefing]) {
    const news = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (a.medium) a.medium, a.title, COALESCE(a.resolved_link, a.link) AS url,
               COALESCE(a.published_at, a.created_at) AS at, a.lang
        FROM articles a WHERE a.id_story = $1 AND a.medium IS NOT NULL
          AND COALESCE(a.resolved_link, a.link) !~ 'news[.]google[.]com'
        ORDER BY a.medium, a.created_at DESC`, story.storyId);
    news.sort((a, b) => b.at - a.at);
    // the lead of the card first when it is known, else the newest
    const lead = news.findIndex(a => a.url === story.leadUrl);
    if (lead > 0) news.unshift(...news.splice(lead, 1));
    if (news.length >= 2) stories.push({...story, title: story.cardTitle ?? news[0].title, media: news.length, news: news.slice(0, PER_STORY * 2)});
}
const pages = await Crawlers.Html([...new Set(stories.flatMap(story => story.news.map(a => a.url)))]);
const byUrl = new Map(pages.map(page => [page.url, page]));
for (const story of stories) {
    story.texts = story.news.filter(a => byUrl.has(a.url))
        .map(a => ({medium: a.medium, at: a.at, url: a.url, sentences: sentencesOf(byUrl.get(a.url)).map(s => s.text).slice(0, SENTENCES)}))
        .filter(t => t.sentences.length >= 3)
        .slice(0, PER_STORY);
}
const readable = stories.filter(story => story.texts.length >= 2);
console.log(`stories ${stories.length} (world ${world.length}, briefing cards ${briefing.length}), with 2+ articles read ${readable.length}`);

// --- "Contesté"
const contestedPrompt = (title, candidates) => `A news card: "${title}"

Sentences of articles on it, each with a verb of denial:
${candidates.map((c, i) => `[${i + 1}] (${c.medium}) ${c.sentence}`).join('\n')}

For each sentence, say whether it reports that someone NAMED (a person, a government, a company, a
lawyer for someone...) denies, disputes or rejects a claim. Not a denial: "did not deny", someone who
"denied" a request, a refusal, an opinion, a criticism, a journalist's own analysis.
And whether the claim denied is the news of the card itself ("main") or another point ("side").
Answer in JSON only: {"sentences": [{"n": 1, "denial": true, "denied_by": "who", "claim": "what, in a few words", "about": "main"}]}`;

// --- "Version différente"
const versionsPrompt = (title, lead, others) => `A news card: "${title}". Its main article, then other articles on it; each sentence numbered.

MAIN (${lead.medium}, ${lead.at.toISOString().slice(0, 16)}):
${lead.sentences.map((s, j) => `[0.${j + 1}] ${s}`).join('\n')}

${others.map((t, i) => `OTHER ${i + 1} (${t.medium}, ${t.at.toISOString().slice(0, 16)}):\n${t.sentences.map((s, j) => `[${i + 1}.${j + 1}] ${s}`).join('\n')}`).join('\n\n')}

Find where an OTHER article tells ONE POINT of the main article's news otherwise: another figure, result,
place, person, cause, sequence of events or account of what was said for the same point. Who is right
does not matter, and a figure that changed later counts too (the reader sees the hours).
NOT another version: the same value in another unit or currency, a detail the main article does not
give, another event or another person, an opinion, a different emphasis.
Answer in JSON only: {"versions": [{"main": "0.4", "other": "2.7", "point": "a few words"}]}
Most cards have none: answer {"versions": []} when you are not sure.`;

const results = await mapWithConcurrency(readable, 3, async (story) => {
    const candidates = story.texts.flatMap(t => t.sentences.filter(s => DENIAL.test(s)).map(sentence => ({medium: t.medium, at: t.at, sentence})))
        .filter((c, i, all) => all.findIndex(o => o.sentence === c.sentence) === i)
        .slice(0, 25);
    let contested = [];
    if (candidates.length > 0) {
        const answer = await askJson(contestedPrompt(story.title, candidates), usage.contested);
        contested = (answer?.sentences ?? []).map(s => ({...s, ...candidates[Number(s.n) - 1]})).filter(s => s.sentence);
    }
    const [lead, ...others] = story.texts;
    const answer = await askJson(versionsPrompt(story.title, lead, others.slice(0, VERSIONS_OTHERS)), usage.versions);
    const at = (ref) => {
        const [i, j] = String(ref ?? '').split('.').map(Number);
        const t = i === 0 ? lead : others[i - 1];
        return t?.sentences[j - 1] ? {medium: t.medium, at: t.at, sentence: t.sentences[j - 1]} : null;
    };
    const versions = (answer?.versions ?? []).map(v => ({point: v.point, main: at(v.main), other: at(v.other)}))
        .filter(v => v.main && v.other && v.main.medium === lead.medium && v.other.medium !== lead.medium);
    return {storyId: story.storyId, from: story.from, title: story.title, media: story.media, read: story.texts.length,
            candidates: candidates.length, contested, versions};
});
const done = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

const shown = (c) => c.denial === true && c.denied_by && c.about === 'main';
const hhmm = (d) => new Date(d).toISOString().slice(5, 16).replace('T', ' ');
const lines = [];
for (const from of ['world', 'briefing']) {
    const set = done.filter(s => s.from === from);
    lines.push(`${from}: stories ${set.length}, with a denial verb ${set.filter(s => s.candidates).length}, `
        + `contested shown ${set.filter(s => s.contested.some(shown)).length} (denials ${set.flatMap(s => s.contested).filter(shown).length}, side ${set.flatMap(s => s.contested).filter(c => c.denial && c.about === 'side').length}, not denials ${set.flatMap(s => s.contested).filter(c => !c.denial).length}), `
        + `versions ${set.flatMap(s => s.versions).length} in ${set.filter(s => s.versions.length).length} stories`);
}
lines.push(`tokens ${JSON.stringify(usage)}, failed ${failed}`);
lines.push('\n===== CONTESTÉ (shown: a named denier, about the news of the card) =====');
for (const s of done) {
    for (const c of s.contested.filter(shown)) lines.push(`#${s.storyId} [${s.from}] ${s.title.slice(0, 90)}\n  ${c.denied_by} — ${c.claim}\n    ${c.medium} ${hhmm(c.at)}: «${c.sentence.slice(0, 280)}»`);
}
lines.push('\n===== VERSIONS DIFFÉRENTES =====');
for (const s of done) {
    for (const v of s.versions) lines.push(`#${s.storyId} [${s.from}] ${s.title.slice(0, 90)}\n  point: ${v.point}\n    MAIN  ${v.main.medium} ${hhmm(v.main.at)}: «${v.main.sentence.slice(0, 250)}»\n    OTHER ${v.other.medium} ${hhmm(v.other.at)}: «${v.other.sentence.slice(0, 250)}»`);
}
lines.push('\n===== left out: side points and not denials =====');
for (const s of done) {
    for (const c of s.contested.filter(c => !shown(c))) lines.push(`#${s.storyId} [${c.denial ? 'side' : 'not a denial'}] ${c.denied_by ?? ''} — ${c.claim ?? ''} :: ${c.medium}: «${c.sentence.slice(0, 200)}»`);
}
fs.writeFileSync(new URL('./data/contested-versions.json', import.meta.url), JSON.stringify(done, null, 1));
fs.writeFileSync(new URL('./data/contested-versions.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
process.exit(0);
