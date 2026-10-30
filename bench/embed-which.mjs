// which embedder of EMBEDDER_URL answers, and how long 4 texts take: node --env-file=.env bench/embed-which.mjs
import {embed} from '../services/utils/embedder.js';
const t = Date.now();
const vectors = await embed(['Lindt cuts its sales forecast', 'Measles outbreak grows in Pennsylvania', 'Artemis II crew returns to Houston', 'La BCE maintient ses taux']);
console.log(`${vectors.length} vectors in ${Date.now() - t} ms`);
process.exit(0);
