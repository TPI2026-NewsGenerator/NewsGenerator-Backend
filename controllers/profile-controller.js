//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-controller.js
//  Description: Controller for the profiles of a user and their interests
//

"use strict"

import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';

// the answer of 'serviceFn', or its error with its status
const respond = async (res, serviceFn, status = 200) => {
    try {
        res.status(status).json(await serviceFn());
    } catch (error) {
        res.status(error.status || 500).json({error: error.message ?? String(error)});
    }
};

const idOf = (req) => Number.parseInt(req.params.id, 10);

export const ProfileController = {
    // A profile is private: the user always comes from the token, never from the request. The profile
    // is the one the request names (X-Profile), checked to be theirs (see activeProfile)
    get: (req, res) => respond(res, () => ProfileService.get(req.user.id, req.profileId)),

    // what can be chosen when writing a profile
    options: (req, res) => res.status(200).json({
        languages: FeedService.languages(),
    }),

    // a profile written with the AI asking questions, before the account is created too:
    // {start, rounds, language} -> {enough, questions}, then -> {text}
    funnelQuestions: (req, res) => respond(res, () => ProfileService.funnelQuestions(req.body ?? {})),
    funnelText: (req, res) => respond(res, () => ProfileService.funnelText(req.body ?? {})),

    // the profile written again, or the first one of a reader who has none
    save: (req, res) => {
        const {text, language} = req.body ?? {};
        return respond(res, () => ProfileService.save(req.user.id, req.profileId, {text, language}));
    },

    // the profiles of the reader, to choose the one read: {profiles: [{id, name}]}
    list: (req, res) => respond(res, async () => ({profiles: await ProfileService.list(req.user.id)})),

    // {name, text, language}: another profile, answered as the one shown
    create: (req, res) => {
        const {name, text, language} = req.body ?? {};
        return respond(res, () => ProfileService.create(req.user.id, {name, text, language}), 201);
    },

    // {name}
    rename: (req, res) => respond(res, () => ProfileService.rename(req.user.id, idOf(req), req.body?.name)),

    remove: (req, res) => respond(res, () => ProfileService.remove(req.user.id, idOf(req))),

    // {terms}: the names or words whose news are always shown
    setWatchTerms: (req, res) => respond(res, () => ProfileService.setWatchTerms(req.user.id, req.profileId, req.body?.terms)),

    updateInterest: (req, res) => {
        const {text, weight} = req.body ?? {};
        return respond(res, () => ProfileService.updateInterest(req.user.id, req.profileId, idOf(req), {text, weight}));
    },

    deleteInterest: (req, res) => respond(res, () => ProfileService.deleteInterest(req.user.id, req.profileId, idOf(req))),

    rediscover: (req, res) => respond(res, () => ProfileService.rediscover(req.user.id, req.profileId)),

    // {key}: a source the thumbs left out, kept by the reader (the key of refusedSources)
    keepSource: (req, res) => respond(res, () => ProfileService.keepSource(req.user.id, req.profileId, req.body?.key)),

    // a source found for the profile, removed by the reader and not found again
    removeSource: (req, res) => respond(res, () => ProfileService.removeSource(req.user.id, req.profileId, Number(req.params.id))),

    // {key}: a source the reader removed, brought back
    restoreSource: (req, res) => respond(res, () => ProfileService.restoreSource(req.user.id, req.profileId, req.body?.key)),
};
