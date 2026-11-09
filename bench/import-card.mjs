// A news added to a briefing (importedCardOf, services/briefing-service.js), made a card as the briefing's are, on the real database and
// the real AI, without saving anything: the card it gives, field by field, to be read against a card of the briefing (the user,
// 03.11.2026: "ajoute le process complet de briefing"). Without an address, one of the news of the last hours that has a story
// of several media is taken.
//   node --env-file=.env bench/import-card.mjs <profileId> [url]
import process from 'node:process';
import pg from 'pg';
import {feedsOf, importedCardOf} from '../services/briefing-service.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {readerLanguage} from '../services/utils/language.js';
import {newUsage} from '../services/utils/ollama.js';
import {prisma} from '../config/db.js';

const profileId = Number(process.argv[2]);
let address = process.argv[3];
if (!address) {
    const client = new pg.Client({connectionString: process.env.DATABASE_URL});
    await client.connect();
    const {rows} = await client.query(`
        SELECT a.link FROM articles a JOIN stories s ON s.id = a.id_story
        WHERE COALESCE(a.published_at, a.created_at) > now() - interval '20 hours'
          AND (SELECT count(DISTINCT medium) FROM articles WHERE id_story = s.id) >= 3
          AND a.link NOT LIKE '%news.google.com%'
        ORDER BY (SELECT count(*) FROM articles WHERE id_story = s.id) DESC LIMIT 1`);
    await client.end();
    address = rows[0].link;
}
console.log(`news: ${address}`);

const profile = await ProfileModel.get(profileId);
const language = readerLanguage(profile ?? {});
const usage = Object.fromEntries(['summarizing', 'contesting', 'reviewing', 'angles', 'official', 'naming', 'titling', 'titleRewriting', 'proofreading', 'writing'].map(step => [step, newUsage()]));
const started = Date.now();
const {card, item, articles} = await importedCardOf({address, links: [address], language, usage, feedUrls: await feedsOf(profileId),
    trusted: new Set(await FeedModel.trustedMedia(profileId)), hours: 48});
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s, story ${item.storyId}, tokens ${JSON.stringify(usage)}`);
const show = (name, value) => console.log(`${name.padEnd(14)} ${typeof value === 'string' ? value : JSON.stringify(value)}`.slice(0, 400));
show('title', card.title);
show('asPublished', card.titleAsPublished);
show('rewritten', card.titleRewritten);
show('translation', card.titleTranslation);
show('language', card.language);
show('topic', card.topic);
show('lead', card.lead);
show('summary', (card.summary ?? '').slice(0, 200));
show('digest', (card.digest ?? '').slice(0, 120));
show('ai', card.ai ? {points: card.ai.points?.length, summary: Boolean(card.ai.summary)} : null);
show('names', (card.names ?? []).map(name => name.name));
show('countries', card.countries);
show('angles', (card.angles ?? []).map(angle => angle.title));
show('official', (card.official ?? []).map(post => `${post.party}: ${post.title}`));
show('contested', (card.contested ?? []).length);
show('corroboration', card.corroboration);
show('articles', (card.articles ?? []).length);
show('pictures', (card.pictures ?? []).length);
show('thumbnail', card.thumbnail);
show('illustration', card.illustration?.name ?? null);
show('hedged', card.hedged);
show('analysisInput', [...articles.entries()].map(([id, list]) => [id, list.length]));
await prisma.$disconnect();
