//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: collect.js
//  Description: Discovery bench, step 2: what the candidate feeds and the shared feeds publish, read
//               every hour for days, kept in the files of the bench (never in the database)
//
//  node bench/discovery/collect.js [--hours 120] [--every 60]
//
// Pruning a feed after a few days can only be judged on what it really published in those days: a
// feed read once gives hours of a busy newspaper and weeks of a small blog. So the feeds are read as
// the ingestion reads them, and every news is kept with the time it was first seen.
// The candidates are read again at each pass: the collection can start while candidates.js still
// works. Stopped and started again, it goes on where it was (the news already kept are skipped).
//
// The news are not written in the database: the ingestion embeds every news of the window, and
// thousands of candidate news would cost hours of it to the users.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {rss} from '../../db/rss-links.js';
import {Crawlers} from '../../services/utils/crawlers.js';

const DATA = path.join(import.meta.dirname, '../data/discovery');
const ITEMS = path.join(DATA, 'items.jsonl');
const STATE = path.join(DATA, 'collect-state.json');
const FEEDS_PER_MEDIUM = 8;         // the best ones of findFeeds, the others are sections off the profile
const DESCRIPTION_CHARS = 500;

const {values: options} = parseArgs({options: {
    hours: {type: 'string', default: '120'},
    every: {type: 'string', default: '60'},
}});
const endAt = Date.now() + Number(options.hours) * 3600e3;
const everyMs = Number(options.every) * 60e3;

fs.mkdirSync(DATA, {recursive: true});

// the feeds to read: the shared ones of the languages of the profiles, and the candidates found so far
const feedsToRead = () => {
    const feeds = new Map();
    const languages = new Set();

    for (const file of fs.readdirSync(DATA).filter(name => /^candidates-.+\.json$/.test(name))) {
        const candidates = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
        candidates.languages.forEach(language => languages.add(language));
        for (const interest of candidates.interests) {
            for (const medium of interest.media) {
                for (const feed of medium.feeds.slice(0, FEEDS_PER_MEDIUM)) feeds.set(feed.url, 'candidate');
            }
        }
    }
    for (const language of languages) {
        for (const url of Object.values(rss[language] ?? {}).flat()) if (!feeds.has(url)) feeds.set(url, 'shared');
    }
    return feeds;
};

// the news already kept, so a pass only adds the new ones
const seen = new Set();
if (fs.existsSync(ITEMS)) {
    for (const line of fs.readFileSync(ITEMS, 'utf8').split('\n')) {
        if (!line) continue;
        const item = JSON.parse(line);
        seen.add(`${item.feed}|${item.link}`);
    }
}
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

const pass = async () => {
    const started = Date.now();
    const feeds = feedsToRead();
    const urls = [...feeds.keys()];

    // the feeds unchanged since the last pass answer 304, as for the ingestion
    const results = await Crawlers.Xml(urls.map(url => ({url, etag: state[url]?.etag, lastModified: state[url]?.lastModified})));

    const now = new Date().toISOString();
    const lines = [];
    let failed = 0;
    for (const result of results) {
        if (result.error) {
            failed++;
            state[result.url] = {...state[result.url], error: result.error, at: now};
            continue;
        }
        state[result.url] = {etag: result.etag ?? state[result.url]?.etag, lastModified: result.lastModified ?? state[result.url]?.lastModified, at: now};

        for (const item of result.items) {
            if (!item.link || seen.has(`${result.url}|${item.link}`)) continue;
            seen.add(`${result.url}|${item.link}`);
            lines.push(JSON.stringify({
                feed: result.url,
                origin: feeds.get(result.url),
                link: item.link,
                title: item.title ?? '',
                description: (item.description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS),
                pubDate: item.pubDate ?? null,
                seen: now,
            }));
        }
    }

    if (lines.length > 0) fs.appendFileSync(ITEMS, lines.join('\n') + '\n');
    fs.writeFileSync(STATE, JSON.stringify(state));
    console.log(`${now} ${urls.length} feeds (${[...feeds.values()].filter(origin => origin === 'candidate').length} candidates), ${failed} failed, ${lines.length} new news, ${Math.round((Date.now() - started) / 1000)} s`);
};

while (Date.now() < endAt) {
    const started = Date.now();
    try {
        await pass();
    } catch (err) {
        console.error(`${new Date().toISOString()} pass failed: ${err.stack ?? err}`);
    }
    const next = started + everyMs;
    if (next >= endAt) break;
    if (next > Date.now()) await new Promise(resolve => setTimeout(resolve, next - Date.now()));
}
process.exit(0);
