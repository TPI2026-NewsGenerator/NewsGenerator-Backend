// The review of the cards (see reviewCards) replayed on the set of bench/review-set.mjs: the prompt of
// the commit 914593a and the one of the code now, 'runs' times each on the cards of each reader. Says
// the good cards left out and the cards on what the reader refuses kept. Read only.
// 'set': all the cards of a reader in one review; 'live': each review with the cards the briefing gave
// it (without the news added on what the reader refuses: with them, the review left out no good card)
//   node --env-file=.env bench/review-replay.mjs <set.json> [runs=3] [set|live]
import {readFileSync} from 'node:fs';
import {ollamaJson} from '../services/utils/ollama.js';
import {normalizeReview, reviewPrompt} from '../services/utils/profile-ai.js';

const [setPath, runsArg, mode = 'set'] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const readers = JSON.parse(readFileSync(setPath, 'utf8')).flatMap(reader => mode === 'live'
    ? reader.reviews.map(ids => ({...reader, cards: ids.map(id => reader.cards.find(card => card.id === id))}))
    : [reader]);

// the prompt of 914593a
const before = (profileText, cards) => `Voici le profil d'un lecteur, écrit par lui-même :
"""${profileText}"""

Voici les cartes de son résumé de l'actualité, chacune avec son identifiant entre crochets, son titre et le résumé de son article :
${cards.map(card => `[${card.id}] ${card.title}\n${card.summary || '(pas de résumé)'}`).join('\n\n')}

Le résumé dit de quoi parle vraiment une carte, mieux que son titre. Dis seulement quelles cartes ont pour sujet principal ce que le lecteur dit explicitement ne pas vouloir, même quand leur titre ne le nommait pas (une équipe d'un sport refusé, un parti d'une politique refusée). Une carte qui ne fait que mentionner un sujet refusé, ou qui s'en approche sans en être, est gardée.
Ne juge pas si une carte est assez proche de ses intérêts : elle a déjà été choisie pour eux, et une carte qui correspond à un seul d'entre eux est gardée. Un sujet que le profil ne mentionne pas n'est pas refusé pour autant : seul compte ce qu'il écrit ne pas vouloir. S'il n'écrit rien de tel, n'enlève aucune carte.
Une carte sans résumé est gardée. Dans le doute, garde la carte.
Réponds uniquement en JSON : {"refused": [{"id": "...", "why": "une phrase courte"}]}`;

// and its reading of the answer
const beforeAnswer = (answer, knownIds) => new Map((Array.isArray(answer?.refused) ? answer.refused : [])
    .map(item => [String(item?.id ?? '').replace(/^\[|\]$/g, ''), String(item?.why ?? '')])
    .filter(([id]) => knownIds.includes(id)));

const prompts = {before, now: (profileText, cards, reader) => reviewPrompt(profileText, cards, reader)};
const readers_ = {before: beforeAnswer, now: normalizeReview};
const totals = Object.fromEntries(Object.keys(prompts).map(name => [name, {wrong: 0, missed: 0, right: 0, outs: 0, keeps: 0}]));
for (const reader of readers) {
    // the cards in an order of their own: the ones added not all at the end
    const cards = mode === 'live' ? reader.cards : [...reader.cards].sort((a, b) => a.title.localeCompare(b.title));
    const asked = cards.map(({id, title, summary}) => ({id: String(id), title, summary}));
    for (const [name, prompt] of Object.entries(prompts)) {
        for (let run = 0; run < runs; run++) {
            // an answer that is no JSON is asked again once, as the briefing would lose only the review
            const answer = await ollamaJson(prompt(reader.profile, asked, reader)).catch(() => ollamaJson(prompt(reader.profile, asked, reader)));
            const leftOut = readers_[name](answer, asked.map(c => c.id));
            const t = totals[name];
            for (const card of cards) {
                const out = leftOut.has(String(card.id));
                if (card.out) { t.outs++; if (out) t.right++; else { t.missed++; console.log(`${name} ${reader.userId} KEPT    ${card.title.slice(0, 90)}`); } }
                else { t.keeps++; if (out) { t.wrong++; console.log(`${name} ${reader.userId} LEFT OUT ${card.title.slice(0, 90)} -> ${leftOut.get(String(card.id))}`); } }
            }
        }
    }
}
for (const [name, t] of Object.entries(totals)) {
    console.log(`${name}: good cards left out ${t.wrong} of ${t.keeps}, refused cards left out ${t.right} of ${t.outs} (${t.missed} kept)`);
}
process.exit(0);
