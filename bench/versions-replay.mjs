// Replays the versions step of the briefing on the cards of a briefing (env BRIEFING, LANGUAGE default
// fr): the stories of the reader's language close to its cards in other languages, and which ones the
// AI joins to them (mergeStories, as keepSameNews asks it). Every feed counts as read
import {prisma} from '../config/db.js';
import {StoryModel} from '../models/story-model.js';
import {mergeStories} from '../services/utils/profile-ai.js';

const language = process.env.LANGUAGE ?? 'fr';
const briefing = await prisma.briefings.findUnique({where: {id: Number(process.env.BRIEFING)}});
const since = new Date(briefing.created_at.getTime() - 48 * 3600e3);
const feedUrls = (await prisma.feeds.findMany({select: {url: true}})).map(feed => feed.url);
const cards = briefing.items.map(item => ({storyId: item.storyId, title: item.title}));
const started = Date.now();
const rows = await StoryModel.versionsIn({storyIds: cards.map(card => card.storyId), language, feedUrls, since, likeness: 0.75, perStory: 2});
console.log(`versionsIn: ${rows.length} rows in ${Date.now() - started} ms`);
const ids = [...new Set(rows.map(row => row.id_version))];
const members = new Map(ids.map(id => [id, []]));
for (const article of await StoryModel.storyArticles({storyIds: ids, feedUrls, since})) members.get(article.id_story).push(article);
const versions = ids.filter(id => members.get(id).length > 0).map(id => ({storyId: id, best: members.get(id)[0]}));
for (const row of rows) console.log(`  ${row.id_story} <- ${row.id_version} ${row.likeness.toFixed(3)} ${members.get(row.id_version)[0]?.title.slice(0, 80)}`);
const brief = (article) => ({title: article.title, description: (article.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)});
const merges = await mergeStories([
    ...cards.map(card => ({id: String(card.storyId), lead: {title: card.title, description: ''}})),
    ...versions.map(version => ({id: String(version.storyId), lead: brief(version.best)})),
]);
const isCard = new Set(cards.map(card => String(card.storyId)));
for (const [id, into] of merges) {
    const title = isCard.has(id) ? cards.find(card => String(card.storyId) === id).title : members.get(Number(id))[0].title;
    console.log(`${isCard.has(id) ? 'card   ' : 'version'} ${id} -> ${into} ${isCard.has(into) ? '' : '(version, ignored)'}: ${title.slice(0, 70)}  =>  ${cards.find(card => String(card.storyId) === into)?.title.slice(0, 50)}`);
}
await prisma.$disconnect();
