//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-model.js
//  Description: The clubs, people and organisations of Wikidata the readers follow, their links, and
//               the ones each profile follows (db/add_entities.sql)
//

"use strict"

import {prisma} from '../config/db.js';

const ENTITY = 'e.id, e.qid, e.label, e.description, e.kind, e.names, e.fetched_at';

export const EntityModel = {
    // {id, qid, label, description, kind, names, fetched_at}, null when not known yet
    byQid: async (qid) => (await prisma.$queryRawUnsafe(`SELECT ${ENTITY} FROM entities e WHERE e.qid = $1`, qid))[0] ?? null,

    // An item read in full from Wikidata, with its links: its row written again, the items it links to
    // added with their label when new (the ones read in full keep theirs), and its links replaced, in
    // one transaction. item: {qid, label, description, kind, names, links: [{qid, label, description, kind, relation}]}
    save: async (item) => prisma.$transaction(async (tx) => {
        const [{id}] = await tx.$queryRawUnsafe(`
            INSERT INTO entities (qid, label, description, kind, names, fetched_at)
            VALUES ($1, $2, $3, $4, $5::text[], now())
            ON CONFLICT (qid) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
                kind = EXCLUDED.kind, names = EXCLUDED.names, fetched_at = now()
            RETURNING id`, item.qid, item.label, item.description, item.kind, item.names);
        await tx.$executeRawUnsafe(`DELETE FROM entity_links WHERE id_from = $1`, id);
        if (item.links.length > 0) {
            await tx.$executeRawUnsafe(`
                INSERT INTO entities (qid, label, description, kind, names)
                SELECT l.qid, l.label, l.description, l.kind, ARRAY[l.label]
                FROM jsonb_to_recordset($1::jsonb) AS l(qid text, label text, description text, kind text)
                ON CONFLICT (qid) DO NOTHING`, JSON.stringify(item.links));
            await tx.$executeRawUnsafe(`
                INSERT INTO entity_links (id_from, id_to, relation)
                SELECT $1, e.id, l.relation
                FROM jsonb_to_recordset($2::jsonb) AS l(qid text, relation text)
                JOIN entities e ON e.qid = l.qid
                ON CONFLICT DO NOTHING`, id, JSON.stringify(item.links));
        }
        return id;
    }),

    // [{id, qid, label, description, kind, names, relation}]: the items this one links to
    links: async (id) => prisma.$queryRawUnsafe(`
        SELECT ${ENTITY}, l.relation FROM entity_links l JOIN entities e ON e.id = l.id_to
        WHERE l.id_from = $1 ORDER BY l.relation, e.label`, id),

    // the items a profile follows, the last followed first, with the names its reader added or took out
    followed: async (profileId) => prisma.$queryRawUnsafe(`
        SELECT ${ENTITY}, p.added_names, p.removed_names,
               (SELECT count(*)::int FROM entity_links l WHERE l.id_from = e.id) AS links
        FROM profile_entities p JOIN entities e ON e.id = p.id_entity
        WHERE p.id_profile = $1 ORDER BY p.created_at DESC`, profileId),

    // {added_names, removed_names} of an item a profile follows, null when it does not follow it
    following: async (profileId, id) => (await prisma.$queryRawUnsafe(`
        SELECT added_names, removed_names FROM profile_entities WHERE id_profile = $1 AND id_entity = $2`, profileId, id))[0] ?? null,

    count: async (profileId) => (await prisma.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM profile_entities WHERE id_profile = $1`, profileId))[0].n,

    follow: async (profileId, id) => prisma.$executeRawUnsafe(`
        INSERT INTO profile_entities (id_profile, id_entity) VALUES ($1, $2) ON CONFLICT DO NOTHING`, profileId, id),

    // how many were followed: 0 when the profile did not follow it
    unfollow: async (profileId, id) => prisma.$executeRawUnsafe(`
        DELETE FROM profile_entities WHERE id_profile = $1 AND id_entity = $2`, profileId, id),

    setNames: async (profileId, id, added, removed) => prisma.$executeRawUnsafe(`
        UPDATE profile_entities SET added_names = $3::text[], removed_names = $4::text[]
        WHERE id_profile = $1 AND id_entity = $2`, profileId, id, added, removed),
};
