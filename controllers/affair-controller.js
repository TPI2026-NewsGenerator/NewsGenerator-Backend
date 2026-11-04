//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-controller.js
//  Description: Controller for the affairs a reader follows, and for the devices that are told when one moves
//

"use strict"

import {AffairService} from '../services/affair-service.js';
import {PushService} from '../services/push-service.js';

const fail = (res, error) => res.status(error.status || 500).json({error: error.message ?? String(error)});

export const AffairController = {
    // {affairs: [{id, title, followedAt, lastEventAt, unread, events, key, media, last}], unread}
    list: async (req, res) => {
        try {
            res.status(200).json(await AffairService.list(req.user.id));
        } catch (error) {
            fail(res, error);
        }
    },

    // {unread}: the badge of the navigation, asked often: one count
    unread: async (req, res) => {
        try {
            res.status(200).json({unread: await AffairService.unread(req.user.id)});
        } catch (error) {
            fail(res, error);
        }
    },

    detail: async (req, res) => {
        try {
            res.status(200).json(await AffairService.detail(req.user.id, req.params.id));
        } catch (error) {
            fail(res, error);
        }
    },

    // {briefingId, storyId}: the affair behind a card of a briefing followed. 201 {id, already: false}, 200 {id, already: true}
    follow: async (req, res) => {
        try {
            const {briefingId, storyId} = req.body ?? {};
            if (!Number.isInteger(storyId) || storyId <= 0) throw Object.assign(new Error('storyId: the story of a card.'), {status: 400});
            const answer = await AffairService.follow(req.user.id, briefingId, storyId);
            res.status(answer.already ? 200 : 201).json(answer);
        } catch (error) {
            fail(res, error);
        }
    },

    seen: async (req, res) => {
        try {
            await AffairService.seen(req.user.id, req.params.id);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    unfollow: async (req, res) => {
        try {
            await AffairService.unfollow(req.user.id, req.params.id);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    // {enabled, publicKey}: whether the server can send, and its key for the browser to subscribe with
    pushKey: (req, res) => res.status(200).json({enabled: PushService.enabled(), publicKey: PushService.publicKey()}),

    // the device of the reader, as the browser gave it: {endpoint, keys: {p256dh, auth}}
    subscribe: async (req, res) => {
        try {
            await PushService.subscribe(req.user.id, req.body, req.get('user-agent'));
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    unsubscribe: async (req, res) => {
        try {
            await PushService.unsubscribe(req.user.id, req.body?.endpoint);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },
};
