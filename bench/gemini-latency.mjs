// The time the Gemini API takes for gemma-4-31b-it, thinking minimal, a few calls in a row and a real
// prompt of the search (3000 tokens). node --env-file=.env bench/gemini-latency.mjs
import process from 'node:process';

const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent';
const ask = async (text) => {
    const started = Date.now();
    const response = await fetch(URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': process.env.AISTUDIO_API_KEY},
        body: JSON.stringify({contents: [{role: 'user', parts: [{text}]}],
            generationConfig: {temperature: 0.1, thinkingConfig: {thinkingLevel: 'minimal'}}}),
    });
    const body = await response.json();
    return `HTTP ${response.status} ${((Date.now() - started) / 1000).toFixed(1)} s ${JSON.stringify(body.usageMetadata ?? body.error?.message ?? '').slice(0, 160)}`;
};
const small = 'Réponds uniquement en JSON : {"capitale": "..."} pour la Suisse.';
for (let i = 0; i < 3; i++) console.log(`small ${i + 1}: ${await ask(small)}`);
const lines = Array.from({length: 80}, (_, i) => `[${i}] Article ${i} sur le football européen et les décisions de l'arbitrage vidéo lors de la journée ${i}`).join('\n');
console.log(`search-like: ${await ask(`Un lecteur cherche : "la VAR". Articles :\n${lines}\nRéponds uniquement en JSON : {"avis": [{"id": "...", "avis": "reponse"}]} pour les 5 premiers.`)}`);
