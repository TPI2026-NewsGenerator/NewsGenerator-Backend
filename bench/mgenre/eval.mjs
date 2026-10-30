// Sends the requests of requests.json to mgenre/server.py (POST /rank) and keeps the log-probabilities:
// scores-<mode>.json. MGENRE_URL (http://192.168.1.183:8022 by default), the token is EMBEDDER_TOKEN of server/.env.
// node --env-file=.env bench/mgenre/eval.mjs [fp32|int8]
import fs from 'node:fs';

const mode = process.argv[2] ?? 'fp32';
const address = process.env.MGENRE_URL ?? 'http://192.168.1.183:8022';
const BATCH = 4;
const requests = JSON.parse(fs.readFileSync(new URL('./requests.json', import.meta.url), 'utf8'));
const headers = {'Content-Type': 'application/json', ...(process.env.EMBEDDER_TOKEN ? {Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`} : {})};
const health = await (await fetch(`${address}/health`)).json();
console.log(`${address}: ${JSON.stringify(health)}`);
const out = [];
const started = Date.now();
for (let i = 0; i < requests.length; i += BATCH) {
    const part = requests.slice(i, i + BATCH).filter(r => r.targets.length > 0);
    const res = await fetch(`${address}/rank`, {method: 'POST', headers, body: JSON.stringify({mode, items: part.map(r => ({id: r.id, source: r.source, targets: r.targets}))})});
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
    out.push(...body.results);
    if (out.length % 20 < BATCH) console.log(`${out.length} of ${requests.length}, ${Math.round((Date.now() - started) / 1000)} s`);
}
fs.writeFileSync(new URL(`./scores-${mode}.json`, import.meta.url), JSON.stringify(out));
const ms = out.map(r => r.ms).sort((a, b) => a - b);
console.log(`${out.length} ranked in ${Math.round((Date.now() - started) / 1000)} s; per name median ${ms[Math.floor(ms.length / 2)]} ms, 95th ${ms[Math.floor(ms.length * 0.95)]} ms`);
