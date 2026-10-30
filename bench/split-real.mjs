// Read only: the real texts of bench/data/funnel-profiles.json split again by the code of now, against
// their split of before (the "real split" of a report of bench/profile-ceiling.mjs): how many interests,
// cut at MAX_INTEREST_TEXT, words left out, and the share of the news of 48 h of the split of before found.
//   node --env-file=.env bench/split-real.mjs <report of before> [profileIds] [runs]
import process from 'node:process';
import fs from 'node:fs';
import {embed, toVector} from '../services/utils/embedder.js';
import {prisma} from '../config/db.js';
import {interestsOf, missingWords, MAX_INTEREST_TEXT} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';

const before = fs.readFileSync(new URL(`./data/${process.argv[2]}`, import.meta.url), 'utf8');
const ids = (process.argv[3] ?? '7,1,4,5,8').split(',');
const RUNS = Number(process.argv[4] ?? 3);
const profiles = JSON.parse(fs.readFileSync(new URL('./data/funnel-profiles.json', import.meta.url), 'utf8'));
const categories = FeedService.categories();

const PER_INTEREST = 40;
const closestNews = async (texts) => {
    const found = new Set();
    for (const vector of await embed(texts)) {
        (await prisma.$queryRawUnsafe(`SELECT id FROM articles WHERE embedded_at IS NOT NULL AND created_at > now() - interval '48 hours'
            ORDER BY text_dense <#> $1::halfvec LIMIT ${PER_INTEREST}`, toVector(vector.dense))).forEach(row => found.add(Number(row.id)));
    }
    return found;
};

for (const id of ids) {
    const profile = profiles.find(p => String(p.id) === id);
    const language = profile.languages[0] ?? 'fr';
    const old = before.match(new RegExp(`######## profile ${id} [^\\n]*\\n((?: {2}- [^\\n]*\\n)+)`))[1]
        .split('\n').filter(Boolean).map(line => line.replace(/^ {2}- /, ''));
    const oldNews = await closestNews(old);
    const runs = [];
    for (let run = 1; run <= RUNS; run++) {
        const {interests, refused} = await interestsOf({text: profile.text, language, categories});
        const news = await closestNews(interests.map(i => i.text));
        runs.push(`${interests.length} interests (${interests.filter(i => i.text.length >= MAX_INTEREST_TEXT).length} cut), `
            + `missing [${missingWords(profile.text, interests, refused).join(' ')}], news of before ${([...oldNews].filter(n => news.has(n)).length / oldNews.size * 100).toFixed(0)}%`
            + interests.map(i => `\n      - ${i.text}`).join(''));
    }
    console.log(`\n## profile ${id}: before ${old.length} interests\n${runs.map((r, i) => `  run ${i + 1}: ${r}`).join('\n')}`);
}
process.exit(0);
