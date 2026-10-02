//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-controller.js
//  Description: Controller for the profile of a user and its interests
//

"use strict"

import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';

// the answer of 'serviceFn', or its error with its status
const respond = async (res, serviceFn) => {
    try {
        res.status(200).json(await serviceFn());
    } catch (error) {
        res.status(error.status || 500).json({error: error.message ?? String(error)});
    }
};

const interestId = (req) => Number.parseInt(req.params.id, 10);

export const ProfileController = {
    // the profile is private: the user always comes from the token, never from the request
    get: (req, res) => respond(res, () => ProfileService.get(req.user.id)),

    // what can be chosen when writing a profile
    options: (req, res) => res.status(200).json({
        topics: ProfileService.topics(),
        languages: FeedService.languages(),
    }),

    save: (req, res) => {
        const {text, topics, language} = req.body ?? {};
        return respond(res, () => ProfileService.save(req.user.id, {text, topics, language}));
    },

    updateInterest: (req, res) => {
        const {text, weight} = req.body ?? {};
        return respond(res, () => ProfileService.updateInterest(req.user.id, interestId(req), {text, weight}));
    },

    deleteInterest: (req, res) => respond(res, () => ProfileService.deleteInterest(req.user.id, interestId(req))),

    rediscover: (req, res) => respond(res, () => ProfileService.rediscover(req.user.id)),

    // {url}: a source the thumbs left out, kept by the reader
    keepSource: (req, res) => respond(res, () => ProfileService.keepSource(req.user.id, req.body?.url)),
};
