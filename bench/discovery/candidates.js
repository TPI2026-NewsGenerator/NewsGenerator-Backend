//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: candidates.js
//  Description: Discovery bench, step 1: every feed the discovery could add for the bench profiles,
//               not only the one it keeps, so the variants can be compared on the same candidates
//
//  node bench/discovery/candidates.js [profile ...]      (all the profiles of profiles.json by default)
//
// The question of the bench: does adding more feeds than the discovery keeps today, then dropping
// the ones that brought nothing after a few days, find more relevant news for the embedding it costs?
// This step records, for each interest, the media Google News names (more than the discovery tries)
// and for each medium every feed findFeeds read, with how much of it was on the profile. collect.js
// then records what these feeds publish, and evaluate.js replays the discovery rules on them.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {interestsOf, parseSearch} from '../../services/utils/profile-ai.js';
import {FeedService} from '../../services/feed-service.js';
import {knownMedia} from '../../services/source-service.js';
import {search} from '../../services/utils/google-news.js';
import {findFeeds} from '../../services/utils/feed-finder.js';
import {embed, denseSimilarity} from '../../services/utils/embedder.js';
import {nameOf} from '../../services/utils/public-url.js';
import {prisma} from '../../config/db.js';

const DATA = path.join(import.meta.dirname, '../data/discovery');
const SEARCH_DAYS = 7;          // as the discovery
const MEDIA_PER_INTEREST = 12;  // the discovery tries 6: the others are the "add more" variants
const JUDGE_THRESHOLD = 0.45;   // as the discovery

const profiles = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'profiles.json'), 'utf8'));
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(profiles);
fs.mkdirSync(DATA, {recursive: true});

// the media Google News names for the searches of an interest, the most present first (as mediaOf
// in discovery-service.js)
const mediaOf = async (searches) => {
    const media = new Map();
    for (const {lang, q} of searches.map(parseSearch).filter(Boolean)) {
        try {
            const found = await search([q], {days: SEARCH_DAYS, language: lang});
            for (const medium of found.media) {
                const key = nameOf(medium.site);
                const known = media.get(key) ?? {site: medium.site, name: medium.name, news: 0, lang};
                known.news += medium.news;
                media.set(key, known);
            }
        } catch (err) {
            console.log(`  Google News failed for "${q}" (${err.message})`);
        }
    }
    return [...media.values()].sort((a, b) => b.news - a.news);
};

// the profile-wide judge of the discovery: a text is on the profile when it is close to one interest
const judgeOf = (denses) => {
    const cache = new Map();
    return async (texts) => {
        const missing = [...new Set(texts.filter(text => !cache.has(text)))];
        if (missing.length > 0) (await embed(missing)).forEach((vector, i) => cache.set(missing[i], vector.dense));
        return texts.map(text => denses.some(dense => denseSimilarity(cache.get(text), dense) >= JUDGE_THRESHOLD));
    };
};

// the shared feeds and the media they already bring are never candidates, as in the discovery
const known = await knownMedia(null, {userFeeds: []});

for (const name of names) {
    const {text, languages} = profiles[name];
    const started = Date.now();
    console.log(`${name}: interests`);

    const interests = await interestsOf({text, topics: [], languages, categories: FeedService.categories()});
    const vectors = await embed(interests.map(interest => interest.text));
    const judge = judgeOf(vectors.map(vector => vector.dense));

    const result = {name, text, languages, createdAt: new Date().toISOString(), interests: []};
    for (const [i, interest] of interests.entries()) {
        const media = (await mediaOf(interest.searches))
            .filter(medium => !known.has(nameOf(medium.site)))
            .slice(0, MEDIA_PER_INTEREST);
        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        console.log(`  interest ${i} "${interest.text.slice(0, 60)}": ${media.length} media`);

        // one medium at a time: the embedder is the slow part and serves them one by one anyway
        for (const medium of media) {
            try {
                medium.feeds = (await findFeeds(medium.site, {language: medium.lang, subject, judge})).map(feed => ({
                    url: feed.url, items: feed.items, newest: feed.newest, built: Boolean(feed.pattern),
                    onSubject: feed.onSubject ?? 0, judged: feed.judged ?? 0, onSubjectPerDay: feed.onSubjectPerDay ?? 0,
                }));
            } catch (err) {
                medium.feeds = [];
                medium.error = err.message;
            }
            console.log(`    ${nameOf(medium.site).padEnd(24)} ${medium.feeds.length} feeds, best ${medium.feeds[0] ? `${medium.feeds[0].onSubject}/${medium.feeds[0].judged}` : '-'}`);
        }

        result.interests.push({
            text: interest.text, weight: interest.weight, keywords: interest.keywords, searches: interest.searches,
            sections: interest.sections, category: interest.category, dense: [...vectors[i].dense], media,
        });
    }

    fs.writeFileSync(path.join(DATA, `candidates-${name}.json`), JSON.stringify(result));
    console.log(`${name}: done in ${Math.round((Date.now() - started) / 1000)} s`);
}

await prisma.$disconnect();
