//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-controller.js
//  Description: Controller for the daily briefing
//

"use strict"

import {BriefingService} from '../services/briefing-service.js';

export const BriefingController = {
    // the last briefing, null when none was ever written
    latest: async (req, res) => {
        try {
            res.status(200).json({briefing: await BriefingService.latest(req.profileId)});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {storyId, vote}: the thumb of the reader on a card, vote null takes it back
    vote: async (req, res) => {
        try {
            await BriefingService.vote(req.user.id, req.params.id, req.body?.storyId, req.body?.vote ?? null);
            res.status(204).end();
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {hours, size}: a new briefing of the news of the last hours, of 'size' cards, written in
    // background: 202 with the briefing running, asked again until ready
    start: async (req, res) => {
        try {
            res.status(202).json({briefing: await BriefingService.start(req.user.id, req.profileId, req.body?.hours ?? undefined, req.body?.size ?? undefined)});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },
};
