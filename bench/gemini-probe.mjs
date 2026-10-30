// What the Gemini API answers for gemma-4-31b-it: JSON asked or not, thinking, tokens, time.
//   node --env-file=.env bench/gemini-probe.mjs
import process from 'node:process';

const URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent';
const ask = async (name, generationConfig) => {
    const started = Date.now();
    const response = await fetch(URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': process.env.AISTUDIO_API_KEY},
        body: JSON.stringify({
            contents: [{role: 'user', parts: [{text: 'Classe ces titres par sport. Réponds uniquement en JSON : {"sports": [{"titre": "...", "sport": "..."}]}\n- Le PSG bat Lyon 2-1\n- Federer revient à Wimbledon\n- Les All Blacks battent la France'}]}],
            generationConfig,
        }),
    });
    const body = await response.json();
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    console.log(`\n${name}: HTTP ${response.status} in ${Date.now() - started} ms`);
    if (!response.ok) return console.log(JSON.stringify(body.error ?? body).slice(0, 400));
    console.log(`  parts: ${parts.map(p => `${p.thought ? 'thought' : 'text'}(${(p.text ?? '').length})`).join(', ')}`);
    console.log(`  text: ${parts.filter(p => !p.thought).map(p => p.text).join('').slice(0, 300)}`);
    console.log(`  usage: ${JSON.stringify(body.usageMetadata)}`);
    console.log(`  finish: ${body.candidates?.[0]?.finishReason}, model: ${body.modelVersion}`);
};
await ask('plain', {temperature: 0.1});
await ask('json mime', {temperature: 0.1, responseMimeType: 'application/json'});
await ask('thinking minimal', {temperature: 0.1, thinkingConfig: {thinkingLevel: 'minimal'}});
await ask('json + minimal', {temperature: 0.1, responseMimeType: 'application/json', thinkingConfig: {thinkingLevel: 'minimal'}});
