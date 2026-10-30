// Read only: the profile funnel. A reader writes a short start, the AI asks questions in rounds, the
// reader answers (here the AI playing the reader, who knows their real profile text and only answers
// what is asked), then the AI writes the profile from the start and the answers. Compared with the real
// text: its meaning (bge-m3), the words of the real text found again, the interests the real split makes
// covered by the ones of the written text, and the refusals. Nothing is written in the database.
//   node --env-file=.env bench/profile-funnel.mjs [profileIds, comma separated] [runs]
// The texts come from bench/data/funnel-profiles.json (bench/funnel-profiles.mjs)
import process from 'node:process';
import fs from 'node:fs';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {embed, toVector} from '../services/utils/embedder.js';
import {prisma} from '../config/db.js';
import {interestsOf, missingWords} from '../services/utils/profile-ai.js';
import {nextQuestions, writeProfile, MAX_ROUNDS} from '../services/utils/profile-funnel.js';
import {FeedService} from '../services/feed-service.js';

// the short start a reader would write, per profile
const STARTS = {
    7: "Je travaille dans l'arbitrage à l'UEFA.",
    1: 'Le tennis.',
    4: 'Les cartes Pokémon.',
    5: "L'astronomie.",
    8: "Je suis informaticien.",
};
const FREE_WORDS = 30;

const ids = (process.argv[2] ?? '7').split(',').map(Number);
const RUNS = Number(process.argv[3] ?? 1);
const profiles = JSON.parse(fs.readFileSync(new URL('./data/funnel-profiles.json', import.meta.url), 'utf8'));
const categories = FeedService.categories();

// the AI playing the reader: it knows the real text, answers only what is asked
const readerPrompt = (target, questions, said) => `Tu joues un lecteur qui crée son profil. Voici ce qu'il pense vraiment, que la personne qui pose les questions ne connaît pas :
"""${target}"""
${said.length ? `Il a déjà écrit, aux questions d'avant : ${said.map(s => `« ${s} »`).join(' ')}\n` : ''}
Réponds à ces questions comme ce lecteur :
${questions.map((q, i) => `${i + 1}. ${q.question}\n   Choix : ${q.options.join(' ; ')}`).join('\n')}

Pour chaque question, coche seulement les choix que son profil nomme, avec ces mots ou d'autres (recopiés tels quels). Un choix plus précis que ce que dit son profil, ou seulement voisin, n'est pas coché : s'il dit « les affaires judiciaires », il ne coche pas « le dopage » ni « la corruption ». Dans "free", écris seulement ce que son profil dit de plus sur le point exact de la question et que ni les choix cochés ni ce qu'il a déjà écrit ne disent, avec ses mots, en ${FREE_WORDS} mots au plus ("" s'il n'y a rien de plus). Ne réponds jamais à une autre question que celle posée : ce qu'on ne lui demande pas, il ne le dit pas. Si son profil ne dit rien sur la question, ne coche rien. N'ajoute rien que son profil ne dit pas.
Réponds uniquement en JSON : {"answers": [{"chosen": ["..."], "free": "..."}]}`;

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / Math.sqrt(na * nb);
};
const timed = async (fn) => { const t = Date.now(); const value = await fn(); return [value, (Date.now() - t) / 1000]; };

// the words of the real text found again in a text (missingWords counts a word named by its start)
const recall = (target, text) => {
    const all = missingWords(target, []);
    const missing = missingWords(target, [{text}]);
    return {share: 1 - missing.length / all.length, missing};
};

const funnel = async (start, target, language, usage) => {
    const rounds = [];
    const times = [];
    for (let r = 0; r < MAX_ROUNDS; r++) {
        const [{enough, questions}, seconds] = await timed(() => nextQuestions({start, rounds, language}, usage));
        times.push(seconds);
        if (enough) break;
        const reply = await ollamaJson(readerPrompt(target, questions, rounds.flat().map(q => q.free).filter(Boolean)));
        const answers = Array.isArray(reply?.answers) ? reply.answers : [];
        rounds.push(questions.map((q, i) => ({
            ...q,
            chosen: (Array.isArray(answers[i]?.chosen) ? answers[i].chosen : []).map(c => clean(c, 80)).filter(c => q.options.includes(c)),
            free: clean(answers[i]?.free, 400),
        })));
    }
    const [text, seconds] = await timed(() => writeProfile({start, rounds, language}, usage));
    times.push(seconds);
    return {rounds, text, times};
};

// The news of the last 48 h closest to each interest (dense, as the first step of the ranking): the
// news a briefing would choose from. Compared between the real split and the one of the written text
const PER_INTEREST = 40;
const closestNews = async (vectors) => {
    const ids = new Set();
    for (const vector of vectors) {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT id FROM articles WHERE embedded_at IS NOT NULL AND created_at > now() - interval '48 hours'
            ORDER BY text_dense <#> $1::halfvec LIMIT ${PER_INTEREST}`, toVector(vector.dense));
        rows.forEach(row => ids.add(Number(row.id)));
    }
    return ids;
};
const found = (real, other) => [...real].filter(id => other.has(id)).length / real.size;

const totals = [];
const summary = [];
const report = [];
const log = (line) => { console.log(line); report.push(line); };

for (const id of ids) {
    const profile = profiles.find(p => p.id === id);
    const target = profile.text;
    const language = profile.languages[0] ?? 'fr';
    const start = STARTS[id];
    const real = await interestsOf({text: target, language, categories});
    const [targetVector, startVector, ...realVectors] = await embed([target, start, ...real.interests.map(i => i.text)]);
    const fromStart = recall(target, start);
    log(`\n######## profile ${id} (${profile.name}, ${language}), start «${start}»`);
    log(`real split: ${real.interests.length} interests, refused ${JSON.stringify(real.refused)}`);
    real.interests.forEach(i => log(`  - ${i.text}`));
    // the real text split again: how close two splits of the same text are, the best a funnel can do
    const again = await interestsOf({text: target, language, categories});
    const againVectors = await embed(again.interests.map(i => i.text));
    const ceiling = realVectors.map(rv => Math.max(0, ...againVectors.map(av => cosine(rv.dense, av.dense))));
    const realNews = await closestNews(realVectors);
    log(`real text split again: covered ${ceiling.map(c => c.toFixed(2)).join(' ')} mean ${(ceiling.reduce((a, b) => a + b, 0) / ceiling.length).toFixed(3)}, news found ${(found(realNews, await closestNews(againVectors)) * 100).toFixed(0)}% of ${realNews.size}`);
    const startSplit = await interestsOf({text: start, language, categories}).catch(() => ({interests: []}));
    const startNews = startSplit.interests.length ? await closestNews(await embed(startSplit.interests.map(i => i.text))) : new Set();
    log(`start alone: meaning ${cosine(startVector.dense, targetVector.dense).toFixed(3)}, words ${(fromStart.share * 100).toFixed(0)}%, news found ${(found(realNews, startNews) * 100).toFixed(0)}%`);

    for (let run = 1; run <= RUNS; run++) {
        const usage = newUsage();
        const result = await funnel(start, target, language, usage);
        const split = await interestsOf({text: result.text, language, categories});
        const [textVector, ...splitVectors] = await embed([result.text, ...split.interests.map(i => i.text)]);
        const covered = realVectors.map(rv => Math.max(0, ...splitVectors.map(sv => cosine(rv.dense, sv.dense))));
        const words = recall(target, result.text);

        log(`\n=== run ${run}: ${result.rounds.length} rounds, ${result.rounds.flat().length} questions, calls ${result.times.map(t => t.toFixed(1)).join(' + ')} s, tokens ${JSON.stringify(usage)}`);
        result.rounds.forEach((round, r) => round.forEach(q => log(`  [${r + 1}] ${q.question}\n      choix: ${q.options.join(' ; ')}\n      coché: ${q.chosen.join(' ; ') || '-'}${q.free ? `\n      écrit: ${q.free}` : ''}`)));
        log(`  TEXT (${result.text.length} chars): ${result.text}`);
        log(`  meaning ${cosine(textVector.dense, targetVector.dense).toFixed(3)}, words ${(words.share * 100).toFixed(0)}%, missing: ${words.missing.join(', ')}`);
        log(`  real interests covered (best cosine): ${covered.map(c => c.toFixed(2)).join(' ')} mean ${(covered.reduce((a, b) => a + b, 0) / covered.length).toFixed(3)}, news found ${(found(realNews, await closestNews(splitVectors)) * 100).toFixed(0)}%`);
        log(`  split: ${split.interests.length} interests, refused ${JSON.stringify(split.refused)}`);
        split.interests.forEach(i => log(`    - ${i.text}`));
        totals.push({id, meaning: cosine(textVector.dense, targetVector.dense), words: words.share,
            covered: covered.reduce((a, b) => a + b, 0) / covered.length, news: found(realNews, await closestNews(splitVectors)),
            seconds: result.times.reduce((a, b) => a + b, 0), questions: result.rounds.flat().length});
    }
    const runs = totals.filter(t => t.id === id);
    const mean = (key) => runs.reduce((sum, t) => sum + t[key], 0) / runs.length;
    summary.push(`profile ${id}: ${runs.length} runs, meaning ${mean('meaning').toFixed(3)}, words ${(mean('words') * 100).toFixed(0)}%, covered ${mean('covered').toFixed(3)}, `
        + `news found ${(mean('news') * 100).toFixed(0)}% (${runs.map(t => (t.news * 100).toFixed(0)).join(' ')}), start alone ${(found(realNews, startNews) * 100).toFixed(0)}%, `
        + `real split again ${(found(realNews, await closestNews(againVectors)) * 100).toFixed(0)}%, ${mean('questions').toFixed(1)} questions, AI ${mean('seconds').toFixed(1)} s`);
}
log('\n######## SUMMARY');
summary.forEach(line => log(line));
fs.writeFileSync(new URL(`./data/profile-funnel-${ids.join('-')}.txt`, import.meta.url), report.join('\n') + '\n');
process.exit(0);
