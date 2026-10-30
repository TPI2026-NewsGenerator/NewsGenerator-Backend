// Read only: "Contesté" (services/utils/contested.js) on the cards of the briefings of one reader, as the
// briefing asks it: its articles read again (the lead, then one per other medium, 5 at most), the
// denials of its news found, translated for the reader. Nothing is written in the database: the
// result goes to bench/data/contested-profile-<user>.{json,txt}, the mock API can show it (CONTESTED=1)
//   node --env-file=.env bench/contested-profile.mjs <profileId> [days]  (a profile, see db/add_profiles.sql)
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {newUsage} from '../services/utils/ollama.js';
import {readerLanguage} from '../services/utils/language.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
// the AI asked again after a failure (Ollama over its quota, Gemini answering an error 500)
const retried = async (ask) => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await ask();
        } catch (err) {
            if (attempt === 5) throw err;
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        }
    }
};
import {contestedOf, hasDenial} from '../services/utils/contested.js';
import {sentencesOf} from '../services/utils/extract.js';

const userId = Number(process.argv[2]);
const DAYS = Number(process.argv[3] ?? 14);
const READ_PER_STORY = 5;
const usage = newUsage();

const language = readerLanguage(await ProfileModel.get(userId));
const rows = await prisma.$queryRawUnsafe(`
    SELECT items FROM briefings WHERE id_profile = $1 AND status = 'ready' AND created_at > now() - make_interval(days => $2)
    ORDER BY created_at DESC`, userId, DAYS);
const cards = [];
const seen = new Set();
for (const row of rows) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
        if (seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        // the lead, then one article per other medium, as toRead does
        const media = new Set();
        const articles = [item.lead, ...(item.articles ?? [])].filter(a => a?.url && !/news\.google\.com/.test(a.url))
            .filter(a => !media.has(a.source) && media.add(a.source)).slice(0, READ_PER_STORY);
        if (articles.length > 0) cards.push({storyId: item.storyId, title: item.title, media: item.corroboration?.media ?? 0, articles});
    }
}
const pages = await Crawlers.Html([...new Set(cards.flatMap(card => card.articles.map(a => a.url)))]);
const byUrl = new Map(pages.filter(page => page.content).map(page => [page.url, page]));
console.log(`reader ${userId} (${language}): ${rows.length} briefings, ${cards.length} cards, ${byUrl.size} pages read`);

const results = await mapWithConcurrency(cards, 2, async (card) => {
    const texts = card.articles.filter(a => byUrl.has(a.url)).map(a => ({...a, page: byUrl.get(a.url)}));
    const candidates = texts.flatMap(t => sentencesOf(t.page).filter(s => hasDenial(s.text)).map(s => `${t.source}: ${s.text}`));
    const contested = await retried(() => contestedOf(card.title, texts, {language, usage}));
    return {storyId: card.storyId, title: card.title, media: card.media, read: texts.length, candidates, contested};
});
const done = results.map(r => r.status === 'fulfilled' ? r.value : {failed: String(r.reason)});

const lines = [`reader ${userId}, ${cards.length} cards, read ${done.filter(c => c.read).length}, with a verb of denial ${done.filter(c => c.candidates?.length).length}, `
    + `contested ${done.filter(c => c.contested?.length).length}, failed ${done.filter(c => c.failed).length}, tokens ${JSON.stringify(usage)}`];
lines.push('\n===== CONTESTED =====');
for (const c of done.filter(c => c.contested?.length)) {
    lines.push(`#${c.storyId} (${c.media} media) ${c.title}`);
    for (const d of c.contested) lines.push(`  ${d.by} denies — ${d.source}: «${d.sentence}»${d.translation ? `\n    → ${d.translation}` : ''}`);
}
lines.push('\n===== left out: a verb of denial, no denial of the news shown =====');
for (const c of done.filter(c => c.candidates?.length && !c.contested?.length)) {
    lines.push(`#${c.storyId} ${c.title}`);
    for (const s of c.candidates.slice(0, 6)) lines.push(`  ${s.slice(0, 220)}`);
}
fs.writeFileSync(new URL(`./data/contested-profile-${userId}.json`, import.meta.url), JSON.stringify(done, null, 1));
fs.writeFileSync(new URL(`./data/contested-profile-${userId}.txt`, import.meta.url), lines.join('\n') + '\n');
console.log(lines[0]);
process.exit(0);
