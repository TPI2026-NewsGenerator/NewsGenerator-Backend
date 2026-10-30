// The first thing to run on the real model: it writes, with no prefix tree, what it links in a few sentences. The
// targets of eval.mjs are in the format it must write ("Olympique Lyonnais >> fr": a title, " >> ", a language).
// MGENRE_URL (http://192.168.1.183:8022 by default), the token is EMBEDDER_TOKEN of server/.env.
// node --env-file=.env bench/mgenre/sanity.mjs [fp32|int8]
const mode = process.argv[2] ?? 'fp32';
const address = process.env.MGENRE_URL ?? 'http://192.168.1.183:8022';
const headers = {'Content-Type': 'application/json', ...(process.env.EMBEDDER_TOKEN ? {Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`} : {})};
const sources = [
    "Coup de théâtre, PSG-[START] OL [END] sur le point d'être reporté !",
    "[START] Napoli [END] ha vinto contro l'Inter allo stadio Maradona.",
    '[START] Pedri [END] lanza un deseo sarcástico a Ferran antes del clásico.',
    'The [START] FMF [END] has set up the electoral college of the Malagasy football federation.',
];
const started = Date.now();
const res = await fetch(`${address}/generate`, {method: 'POST', headers, body: JSON.stringify({mode, sources, beams: 3})});
const body = await res.json();
if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
body.results.forEach((result, i) => console.log(`${sources[i]}\n   ${result.texts.map((text, j) => `${text} (${result.scores[j]})`).join('  |  ')}`));
console.log(`${Date.now() - started} ms for ${sources.length} sentences`);
