// Read only: the ceiling of bench/profile-funnel.mjs. The real text rewritten by the AI with all its
// content and other words, then split and compared as a funnel's text is: the share of the news of 48 h
// a text saying the same thing finds. Nothing is written in the database.
//   node --env-file=.env bench/profile-ceiling.mjs [profileIds, comma separated] [runs]
import process from 'node:process';
import fs from 'node:fs';
import {ollamaJson} from '../services/utils/ollama.js';
import {embed, toVector} from '../services/utils/embedder.js';
import {prisma} from '../config/db.js';
import {interestsOf, missingWords} from '../services/utils/profile-ai.js';
import {languageName} from '../services/utils/language.js';
import {FeedService} from '../services/feed-service.js';

const ids = (process.argv[2] ?? '7,1').split(',').map(Number);
const RUNS = Number(process.argv[3] ?? 3);
const profiles = JSON.parse(fs.readFileSync(new URL('./data/funnel-profiles.json', import.meta.url), 'utf8'));
const categories = FeedService.categories();

// in: the language to write it in, null for the one of the text
const rewritePrompt = (text, into) => `Voici le profil d'un lecteur de nouvelles, écrit par lui :
"""${text}"""
Réécris-le à la première personne${into ? `, en ${languageName(into, 'fr')}` : ', dans sa langue'}, avec d'autres mots et dans un autre ordre, comme s'il l'avait écrit un autre jour. Garde tout ce qu'il dit : chaque sujet, chaque nom, chaque genre de nouvelle, chaque refus. N'ajoute rien. Des paragraphes courts, pas de liste.
Réponds uniquement en JSON : {"text": "..."}`;

const PER_INTEREST = 40;            // as bench/profile-funnel.mjs
const closestNews = async (vectors) => {
    const found = new Set();
    for (const vector of vectors) {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT id FROM articles WHERE embedded_at IS NOT NULL AND created_at > now() - interval '48 hours'
            ORDER BY text_dense <#> $1::halfvec LIMIT ${PER_INTEREST}`, toVector(vector.dense));
        rows.forEach(row => found.add(Number(row.id)));
    }
    return found;
};
const share = (real, other) => [...real].filter(id => other.has(id)).length / real.size;
const newsOf = async (text, language) => {
    const split = await interestsOf({text, language, categories});
    return {split, news: await closestNews(await embed(split.interests.map(i => i.text)))};
};
const recall = (target, text) => 1 - missingWords(target, [{text}]).length / missingWords(target, []).length;

const report = [];
const summary = [];
const log = (line) => { console.log(line); report.push(line); };

for (const id of ids) {
    const profile = profiles.find(p => p.id === id);
    const language = profile.languages[0] ?? 'fr';
    const real = await newsOf(profile.text, language);
    log(`\n######## profile ${id} (${profile.name}, ${language}): ${real.split.interests.length} interests, ${real.news.size} news`);
    real.split.interests.forEach(i => log(`  - ${i.text}`));
    // the text in its own language, and in the reader's language when the funnel writes in another one
    const ways = [null, ...(/[éèàç]/i.test(profile.text) && language !== 'fr' ? [language] : [])];
    for (const into of ways) {
        const results = [];
        for (let run = 1; run <= RUNS; run++) {
            const text = (await ollamaJson(rewritePrompt(profile.text, into)))?.text ?? '';
            const {split, news} = await newsOf(text, language);
            results.push({news: share(real.news, news), words: recall(profile.text, text)});
            log(`\n=== ${into ? `in ${into}` : 'same language'}, run ${run}: news found ${(results.at(-1).news * 100).toFixed(0)}%, words ${(results.at(-1).words * 100).toFixed(0)}%, ${split.interests.length} interests`);
            log(`  TEXT: ${text}`);
            split.interests.forEach(i => log(`    - ${i.text}`));
        }
        const mean = (key) => results.reduce((sum, r) => sum + r[key], 0) / results.length;
        summary.push(`profile ${id} ${into ? `in ${into}` : 'same language'}: news found ${(mean('news') * 100).toFixed(0)}% (${results.map(r => (r.news * 100).toFixed(0)).join(' ')}), words ${(mean('words') * 100).toFixed(0)}%`);
    }
}
log('\n######## SUMMARY');
summary.forEach(line => log(line));
fs.writeFileSync(new URL(`./data/profile-ceiling-${ids.join('-')}.txt`, import.meta.url), report.join('\n') + '\n');
process.exit(0);
