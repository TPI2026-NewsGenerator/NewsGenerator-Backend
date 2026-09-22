//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-controller.js
//  Description: Controller for the feeds added by a user (private to them)
//

"use strict"

import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {findFeeds} from '../services/utils/feed-finder.js';

export const MAX_USER_FEEDS = 20;   // a user can't fill the refresh with thousands of feeds

const toFeed = (feed) => ({
    id: feed.id,
    url: feed.url,
    site: feed.site,
    category: feed.category,
    createdAt: feed.created_at,
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
            const feeds = await findFeeds(site);
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
