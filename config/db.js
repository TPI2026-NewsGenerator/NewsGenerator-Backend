//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: db.js
//  Description: Prisma set up
//

"use strict"

import process from 'node:process'
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });