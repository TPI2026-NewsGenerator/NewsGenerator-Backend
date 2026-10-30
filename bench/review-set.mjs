// The set the review of the cards (see reviewCards) is replayed on (bench/review-replay.mjs): the cards
// of the reviews gathered by bench/review-cases.mjs, judged by hand, and recent news on what each
// reader refuses, their description as their passages, that it must still leave out. Read only.
//   node --env-file=.env bench/review-set.mjs <cases.json> <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import pg from 'pg';
import {ProfileModel} from '../models/profile-model.js';

const [casesPath, out] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

// the cards of the gathered reviews to leave out, judged by hand: an app of general AI for the
// reader who wants AI on coding only. The others were left out wrongly (a connected home on a
// reader of "nouveautés en technologies", a federal referendum on cantonal minimum wages) or kept
const OUT = new Set(['331821']);
// news on what the readers refuse (articles of 4 to 7 October 2026)
const REFUSED = {
    4: [44927334, 33599006, 44730798],              // general AI: watermarks of ChatGPT, IPO of Anthropic, chats read
    482: [43906456, 45495997],                      // transfers of players
    384: [43097183, 45565740],                      // sports betting
    129: [45143166, 43097183],                      // people, sports betting
    389: [45143166, 43759636],                      // people, a crime
    311: [41888100, 45526513],                      // football
    290: [33734865],                                // a Pokémon video game
    154: [45199506, 45583635, 44986101, 41706052, 41888100], // cantonal politics, crypto, football
};
// news close to what a reader refuses that must be kept: a court case on a transfer (governance)
const KEPT = {482: [45027635]};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const articleCard = async (id) => {
    const {rows: [a]} = await db.query(`SELECT id, title, regexp_replace(coalesce(description, ''), '<[^>]*>|\\s+', ' ', 'g') AS d FROM articles WHERE id = $1`, [id]);
    return {id: `a${a.id}`, title: a.title, summary: a.d.trim().slice(0, 600) || null};
};

const readers = [];
for (const userId of [...new Set(cases.map(c => c.userId))]) {
    const profile = await ProfileModel.get(userId);
    const interests = (await ProfileModel.interests(userId)).map(i => i.text);
    const seen = new Map();
    for (const review of cases.filter(c => c.userId === userId)) {
        for (const card of review.cards) {
            if (!seen.has(card.id)) seen.set(card.id, {id: card.id, title: card.title, summary: card.summary, out: OUT.has(card.id), was: card.leftOut});
        }
    }
    for (const id of REFUSED[userId] ?? []) seen.set(`a${id}`, {...await articleCard(id), out: true, added: true});
    for (const id of KEPT[userId] ?? []) seen.set(`a${id}`, {...await articleCard(id), out: false, added: true});
    // the cards of each review as the briefing asked it, to replay it as it was
    const reviews = cases.filter(c => c.userId === userId).map(review => review.cards.map(card => card.id));
    readers.push({userId, profile: profile.text, refused: profile.refused ?? [], interests, cards: [...seen.values()], reviews});
}
await db.end();
writeFileSync(out, JSON.stringify(readers, null, 1));
for (const r of readers) console.log(`${r.userId}: ${r.cards.length} cards, ${r.cards.filter(c => c.out).length} to leave out`);
process.exit(0);
