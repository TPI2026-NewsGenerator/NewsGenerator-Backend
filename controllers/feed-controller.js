//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-controller.js
//  Description: Controller for the feeds added by a user (private to them)
//

"use strict"

import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {SourceService} from '../services/source-service.js';
import {findFeeds} from '../services/utils/feed-finder.js';
import {assertPublicUrl, isBridgeUrl} from '../services/utils/public-url.js';
import {Crawlers} from '../services/utils/crawlers.js';

export const MAX_USER_FEEDS = 20;   // a user can't fill the refresh with thousands of feeds

const toFeed = (feed) => ({
    id: feed.id,
    url: feed.url,
    site: feed.site,
    category: feed.category,
    createdAt: feed.created_at,
    error: feed.last_error ?? null,             // why the last refresh of this feed failed
    lastFetchedAt: feed.last_fetched_at ?? null,
});

export const FeedController = {
    getUserFeeds: async (req, res) => {
        const feeds = await FeedModel.listUserFeeds(req.user.id);
        res.status(200).json({feeds: feeds.map(toFeed)});
    },

    // the user gives a site ("fortune.com") or a feed, the server finds the feed and checks it answers
    addUserFeed: async (req, res) => {
        const {site, category} = req.body;

        if (typeof site !== 'string' || site.trim() === '') {
            return res.status(400).json({error: "Please enter the address of a website."});
        }
        if (!FeedService.categories().includes(category)) {
            return res.status(400).json({error: `Category must be one of: ${FeedService.categories().join(', ')}.`});
        }
        if (await FeedModel.countUserFeeds(req.user.id) >= MAX_USER_FEEDS) {
            return res.status(400).json({error: `You can't have more than ${MAX_USER_FEEDS} sources.`});
        }

        try {
            const feeds = await findFeeds(site, {language: 'en'});
            if (feeds.length === 0) {
                return res.status(400).json({error: `No RSS feed found on "${site}".`});
            }

            // the feed with the most news
            const found = feeds[0];
            const feed = await FeedModel.addUserFeed({
                userId: req.user.id,
                url: found.url,
                site: site.trim(),
                category: category,
            });

            res.status(200).json({feed: toFeed(feed), sample: found.titles});
        } catch (error) {
            if (error.code === 'P2002') {   // unique (id_user, url)
                return res.status(400).json({error: "You already added this source."});
            }
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // media covering the search of the user and missing from their sources, with the feed to add
    suggestSources: async (req, res) => {
        const {keywords, timeframe} = req.body;

        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({error: "Keywords are required to look for missing sources."});
        }

        try {
            const suggestions = await SourceService.suggest({
                keywords: keywords,
                timeframe: timeframe ?? {},
                userId: req.user.id,
            });

            res.status(200).json(suggestions);
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // feeds of the directory for a subject or a site, to be added like a suggestion
    searchSources: async (req, res) => {
        const {query} = req.body;

        if (typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({error: "Enter a subject or a website to search for."});
        }

        try {
            res.status(200).json(await SourceService.searchDirectory({
                query: query.trim(),
                userId: req.user.id,
            }));
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // add several suggested sources at once, their feed is checked again here: what the client sends
    // back is never trusted, it could be any address, and a directory can name a feed that died
    importSources: async (req, res) => {
        const {sources} = req.body;

        if (!Array.isArray(sources) || sources.length === 0) {
            return res.status(400).json({error: "Please select at least one source."});
        }

        // one read of each feed, so a dead one is refused instead of being added and never working
        const checked = new Map((await Crawlers.Xml(sources.map(source => ({url: source.feed}))))
            .map(result => [result.url, result]));

        const added = [];
        const errors = [];
        let count = await FeedModel.countUserFeeds(req.user.id);

        for (let {site, feed, category} of sources) {
            // only the server builds an address on its own bridge, a client never names one
            if (isBridgeUrl(feed)) {
                errors.push({site, error: "This address can't be added."});
                continue;
            }

            const read = checked.get(feed);
            if (read && (read.error || read.items.length === 0)) {
                errors.push({site, error: read.error ? `This feed does not answer (${read.error}).` : "This feed has no news."});
                continue;
            }

            if (count >= MAX_USER_FEEDS) {
                errors.push({site, error: `You can't have more than ${MAX_USER_FEEDS} sources.`});
                continue;
            }
            if (!FeedService.categories().includes(category)) {
                errors.push({site, error: `Unknown category "${category}".`});
                continue;
            }

            try {
                const url = (await assertPublicUrl(feed)).href;
                added.push(toFeed(await FeedModel.addUserFeed({
                    userId: req.user.id,
                    url: url,
                    site: String(site ?? '').trim() || url,
                    category: category,
                })));
                count++;
            } catch (error) {
                const message = error.code === 'P2002' ? "You already added this source." : error.message;
                errors.push({site, error: message ?? String(error)});
            }
        }

        res.status(200).json({feeds: added, errors});
    },

    deleteUserFeed: async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({error: "An id is required."});
        }

        const deleted = await FeedModel.deleteUserFeed(req.user.id, id);
        if (deleted === 0) {
            return res.status(404).json({error: "This source does not exist."});
        }

        res.status(200).json({deleted: true});
    },
}
