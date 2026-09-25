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

// The adapter reads a timestamptz as if the connection were in UTC: it replaces the offset Postgres
// gives ("14:51+02") by "+00:00". On a server set to Europe/Zurich every date read was two hours
// ahead in summer, one in winter. The connection is put in UTC so what it reads is what is stored.
const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    options: '-c TimeZone=UTC',
});

export const prisma = new PrismaClient({ adapter });