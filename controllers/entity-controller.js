//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-controller.js
//  Description: Controller for the clubs, people and organisations a profile follows
//

"use strict"

import {EntityService} from '../services/entity-service.js';

const respond = async (res, work, status = 200) => {
    try {
        res.status(status).json(await work());
    } catch (error) {
        res.status(error.status || 500).json({error: error.message ?? String(error)});
    }
};

export const EntityController = {
    // ?q=: {items: [{qid, label, description}]}, of Wikidata
    search: (req, res) => respond(res, async () => ({items: await EntityService.search(req.profileId, req.query.q)})),
    // {entities}: the ones the profile follows
    list: (req, res) => respond(res, async () => ({entities: await EntityService.list(req.profileId)})),
    // {qid}: followed, {entities}
    follow: (req, res) => respond(res, async () => ({entities: await EntityService.follow(req.profileId, req.body?.qid)}), 201),
    unfollow: (req, res) => respond(res, async () => ({entities: await EntityService.unfollow(req.profileId, req.params.qid)})),
    // {added, removed}: {entity}
    setNames: (req, res) => respond(res, async () => ({entity: await EntityService.setNames(req.profileId, req.params.qid, req.body ?? {})})),
    // ?hours=24|48|168: the page of the item
    page: (req, res) => respond(res, () => EntityService.page(req.profileId, req.params.qid, Number(req.query.hours ?? 48))),
};
