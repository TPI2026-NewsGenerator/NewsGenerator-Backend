//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-controller.js
//  Description: Controller for the map "The FIFA presidency": the map, the sheet of an association, the presidents, the confederations, the candidates
//               (a reader adds one) and the votes of the readers (see fifa-service.js)
//

"use strict"

import {FifaService} from '../services/fifa-service.js';
import {isAdmin} from '../services/utils/admin.js';

const fail = (res, error) => res.status(error.status || 500).json({error: error.message ?? String(error)});

export const FifaController = {
    map: async (req, res) => {
        try {
            res.status(200).json(await FifaService.map());
        } catch (error) {
            fail(res, error);
        }
    },

    association: async (req, res) => {
        try {
            res.status(200).json(await FifaService.association(req.params.qid, req.user.id));
        } catch (error) {
            fail(res, error);
        }
    },

    presidents: async (req, res) => {
        try {
            res.status(200).json(await FifaService.presidents());
        } catch (error) {
            fail(res, error);
        }
    },

    confederations: async (req, res) => {
        try {
            res.status(200).json(await FifaService.confederations());
        } catch (error) {
            fail(res, error);
        }
    },

    subjects: async (req, res) => {
        try {
            res.status(200).json(await FifaService.subjects());
        } catch (error) {
            fail(res, error);
        }
    },

    // ?q=: the persons of Wikidata whose name starts so, for the reader who adds a candidate: {people: [{qid, name, description}]}
    people: async (req, res) => {
        try {
            const q = String(req.query.q ?? '').trim();
            if (q.length < 2) throw Object.assign(new Error('q: two letters at least.'), {status: 422});
            res.status(200).json(await FifaService.people(q));
        } catch (error) {
            fail(res, error);
        }
    },

    // {qid, status?}: a reader adds a candidate. 201 {subject, already: false}, 200 {subject, already: true}
    addSubject: async (req, res) => {
        try {
            const {qid, status} = req.body ?? {};
            const answer = await FifaService.addSubject({qid, status, userId: req.user.id});
            res.status(answer.already ? 200 : 201).json(answer);
        } catch (error) {
            fail(res, error);
        }
    },

    // {status}: declared, rumoured, withdrawn
    setStatus: async (req, res) => {
        try {
            await FifaService.setStatus(req.params.qid, req.body?.status);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    removeSubject: async (req, res) => {
        try {
            await FifaService.removeSubject(req.params.qid);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    // {subject, member, value: for|against|unknown|withdraw|confirm, note?, source?: {url}} -> {ok, human, confirmed}
    vote: async (req, res) => {
        try {
            const {subject, member, value, note, source} = req.body ?? {};
            res.status(200).json(await FifaService.vote({userId: req.user.id, subject, member, value, note, source}));
        } catch (error) {
            fail(res, error);
        }
    },

    // {member, subject: a candidate | "none" | "withdraw", source?: {url}, note?}: the reader says which candidate an association leans toward, with the page that says
    // it when they have one -> {ok, positions, lean}
    lean: async (req, res) => {
        try {
            const {member, subject, source, note} = req.body ?? {};
            res.status(200).json(await FifaService.lean({userId: req.user.id, member, subject, source, note}));
        } catch (error) {
            fail(res, error);
        }
    },

    // ?limit=&offset=&scope=football|all: the news of the last 30 days that name the president of the association, the newest first -> {leader, scope, total, total_all, total_football, limit, offset, articles}
    leaderNews: async (req, res) => {
        try {
            res.status(200).json(await FifaService.leaderNews({qid: req.params.qid, limit: req.query.limit, offset: req.query.offset, scope: req.query.scope}));
        } catch (error) {
            fail(res, error);
        }
    },

    // {member, text}: a note on an association, visible to every reader -> 201 {note: {id, by, at, text, mine}}
    addNote: async (req, res) => {
        try {
            const {member, text} = req.body ?? {};
            res.status(201).json(await FifaService.addNote({userId: req.user.id, member, text}));
        } catch (error) {
            fail(res, error);
        }
    },

    // the author of a note or an administrator takes it off
    removeNote: async (req, res) => {
        try {
            await FifaService.removeNote({id: req.params.id, userId: req.user.id, admin: await isAdmin(req.user.id)});
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    // {member, source: {url}, note?}: a source added on its own, with no candidate -> 201 {source}
    addSource: async (req, res) => {
        try {
            const {member, source, note} = req.body ?? {};
            res.status(201).json(await FifaService.addSource({userId: req.user.id, member, source, note}));
        } catch (error) {
            fail(res, error);
        }
    },

    // the author of a source added on its own or an administrator takes it off
    removeSource: async (req, res) => {
        try {
            await FifaService.removeSource({id: req.params.id, userId: req.user.id, admin: await isAdmin(req.user.id)});
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    // the last audits of the positions shown (an administrator)
    audits: async (req, res) => {
        try {
            res.status(200).json(await FifaService.audits());
        } catch (error) {
            fail(res, error);
        }
    },

    removeVote: async (req, res) => {
        try {
            await FifaService.removeVote(req.params.id);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },
};
