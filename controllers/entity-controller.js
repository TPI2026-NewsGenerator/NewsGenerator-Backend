//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-controller.js
//  Description: Controller for what a profile follows: the clubs, people and organisations of
//               Wikidata, and the names or words as written
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
    // {entities, words, limits}: what the profile follows, the items and the names or words as written
    list: (req, res) => respond(res, () => EntityService.all(req.profileId)),
    // {names}: names of its cards the profile could follow
    suggestions: (req, res) => respond(res, async () => ({names: await EntityService.suggestions(req.profileId)})),
    // ?name=&hours=: the page of a name as written
    namePage: (req, res) => respond(res, () => EntityService.namePage(req.profileId, req.query.name, Number(req.query.hours ?? 48))),
    // {word}: followed as written, {words}
    addWord: (req, res) => respond(res, () => EntityService.addWord(req.profileId, req.body?.word), 201),
    removeWord: (req, res) => respond(res, () => EntityService.removeWord(req.profileId, req.params.word)),
    // {on}: its news in the briefing or not, {entity}
    setInBriefing: (req, res) => respond(res, async () => ({entity: await EntityService.setInBriefing(req.profileId, req.params.qid, req.body?.on)})),
    // {qid}: followed, {entities}
    follow: (req, res) => respond(res, async () => ({entities: await EntityService.follow(req.profileId, req.body?.qid)}), 201),
    unfollow: (req, res) => respond(res, async () => ({entities: await EntityService.unfollow(req.profileId, req.params.qid)})),
    // {added, removed}: {entity}
    setNames: (req, res) => respond(res, async () => ({entity: await EntityService.setNames(req.profileId, req.params.qid, req.body ?? {})})),
    // ?hours=24 to 168, by days: the page of the item
    page: (req, res) => respond(res, () => EntityService.page(req.profileId, req.params.qid, Number(req.query.hours ?? 48))),
};
