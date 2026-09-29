//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: user-model.js
//  Description: The accounts created by the readers themselves
//

"use strict"

import {prisma} from '../config/db.js';

export const UserModel = {
    // an account already using this name or this email, whatever their case
    taken: async (username, email) => Boolean(await prisma.users.findFirst({
        where: {OR: [
            {username: {equals: username, mode: 'insensitive'}},
            {email: {equals: email, mode: 'insensitive'}},
        ]},
        select: {id: true},
    })),

    roleId: async (role) => (await prisma.roles.findUnique({where: {role}}))?.id ?? null,

    // password: already hashed
    create: async ({username, email, password, role}) => prisma.users.create({
        data: {username, email, password, role},
        select: {id: true, username: true, email: true, role: true},
    }),

    // an account whose profile could not be saved: its profile and interests go with it (cascade)
    delete: async (id) => prisma.users.delete({where: {id}}),
};
