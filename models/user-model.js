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

    // another account using this name, whatever its case: a reader may change the case of their own
    nameTakenByOther: async (username, id) => Boolean(await prisma.users.findFirst({
        where: {username: {equals: username, mode: 'insensitive'}, NOT: {id}},
        select: {id: true},
    })),

    // the account with its password hash, to check it before a change
    withPassword: async (id) => prisma.users.findUnique({
        where: {id},
        select: {id: true, username: true, email: true, role: true, password: true},
    }),

    // the second of its last change of password, 0 when never, null when there is no such account
    passwordChangedAt: async (id) => {
        const user = await prisma.users.findUnique({where: {id}, select: {password_changed_at: true}});
        if (!user) return null;
        return user.password_changed_at ? Math.floor(user.password_changed_at.getTime() / 1000) : 0;
    },

    // data: {username} or {password, password_changed_at}, the password already hashed
    update: async (id, data) => prisma.users.update({
        where: {id},
        data,
        select: {id: true, username: true, email: true, role: true},
    }),

    roleId: async (role) => (await prisma.roles.findUnique({where: {role}}))?.id ?? null,

    // password: already hashed
    create: async ({username, email, password, role}) => prisma.users.create({
        data: {username, email, password, role},
        select: {id: true, username: true, email: true, role: true},
    }),

    // an account whose profile could not be saved: its profile and interests go with it (cascade)
    delete: async (id) => prisma.users.delete({where: {id}}),

    // the address the user gave, to send them what they ask for
    email: async (id) => prisma.users.findUnique({where: {id}, select: {email: true}}),
};
