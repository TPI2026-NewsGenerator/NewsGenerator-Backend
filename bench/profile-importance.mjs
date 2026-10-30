// Read only: does the profile funnel learn which subjects count most for the reader? The AI plays a
// reader who knows their profile (the real texts of bench/data/funnel-profiles.json, with what counts
// most added to some), answers only what is asked; the profile written is split, and the weight of each
// interest compared with the truth: 1 for a subject followed closely, under 1 for one followed from
// further. The text itself split ("direct") shows what the rule of the weight does alone.
// Nothing is written in the database.
//   node --env-file=.env bench/profile-importance.mjs [cases, comma separated] [runs] [label]
import process from 'node:process';
import fs from 'node:fs';
import {ollamaJson} from '../services/utils/ollama.js';
import {interestsOf} from '../services/utils/profile-ai.js';
import {nextQuestions, writeProfile, MAX_ROUNDS} from '../services/utils/profile-funnel.js';
import {FeedService} from '../services/feed-service.js';

const profiles = JSON.parse(fs.readFileSync(new URL('./data/funnel-profiles.json', import.meta.url), 'utf8'));
const textOf = (id) => profiles.find(p => p.id === id).text.trim();

// subjects: [name, pattern of an interest about it, main]. An interest matching no subject or several
// is not scored, only shown
const CASES = {
    tennis: {
        start: 'Le tennis.',
        target: `${textOf(1)} Le tennis passe avant tout ; l'intelligence artificielle et la politique suisse, je les suis de plus loin, seulement ce qui compte vraiment.`,
        subjects: [['tennis', /tennis|ATP|Chelem/i, true], ['IA', /intelligence artificielle|\bIA\b|\bAI\b/i, false], ['politique', /politique|votation|Conseil fédéral/i, false]],
    },
    astro: {
        start: "L'astronomie.",
        target: `${textOf(5)} L'astronomie compte le plus pour moi ; les voitures électriques, je les suis de loin.`,
        subjects: [['astronomie', /astronom|spatial|télescope|exoplan|NASA|ESA/i, true], ['voitures', /voiture|électrique|batterie|recharge/i, false]],
    },
    voile: {
        start: 'La voile.',
        target: `${textOf(6)} La voile d'abord ; l'astronomie, seulement de temps en temps.`,
        subjects: [['voile', /voile|Vendée|America|large/i, true], ['astronomie', /astronom|spatial|télescope/i, false]],
    },
    equal: {
        start: 'Le football français.',
        target: `${textOf(2)} Les deux comptent autant pour moi.`,
        subjects: [['football', /football|Ligue 1|PSG|OM\b|équipe de France/i, true], ['gastronomie', /gastronom|restaurant|chef|Michelin|table/i, true]],
    },
    enzo: {
        start: "Je travaille dans l'arbitrage à l'UEFA.",
        target: textOf(7),
        // FIFA, "an opening", always went with UEFA in one interest: only false secondaries are looked for
        subjects: [['UEFA', /UEFA|arbitrage|VAR|IFAB|gouvernance|fédération|dirigeant|sponsor/i, true]],
    },
    pokemon: {
        start: 'Les cartes Pokémon.',
        target: textOf(4),
        subjects: [['Pokémon', /Pokémon|TCG|cartes/i, true]],
    },
};

const names = (process.argv[2] ?? Object.keys(CASES).join(',')).split(',');
const RUNS = Number(process.argv[3] ?? 2);
const LABEL = process.argv[4] ?? 'run';
const categories = FeedService.categories();
const language = 'fr';
const FREE_WORDS = 30;

// as in bench/profile-funnel.mjs
const readerPrompt = (target, questions, said) => `Tu joues un lecteur qui crée son profil. Voici ce qu'il pense vraiment, que la personne qui pose les questions ne connaît pas :
"""${target}"""
${said.length ? `Il a déjà écrit, aux questions d'avant : ${said.map(s => `« ${s} »`).join(' ')}\n` : ''}
Réponds à ces questions comme ce lecteur :
${questions.map((q, i) => `${i + 1}. ${q.question}\n   Choix : ${q.options.join(' ; ')}`).join('\n')}

Pour chaque question, coche seulement les choix que son profil nomme, avec ces mots ou d'autres (recopiés tels quels). Un choix plus précis que ce que dit son profil, ou seulement voisin, n'est pas coché : s'il dit « les affaires judiciaires », il ne coche pas « le dopage » ni « la corruption ». Dans "free", écris seulement ce que son profil dit de plus sur le point exact de la question et que ni les choix cochés ni ce qu'il a déjà écrit ne disent, avec ses mots, en ${FREE_WORDS} mots au plus ("" s'il n'y a rien de plus). Ne réponds jamais à une autre question que celle posée : ce qu'on ne lui demande pas, il ne le dit pas. Si son profil ne dit rien sur la question, ne coche rien. N'ajoute rien que son profil ne dit pas.
Réponds uniquement en JSON : {"answers": [{"chosen": ["..."], "free": "..."}]}`;

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const IMPORTANCE = /de (très )?près|plus loin|de loin|autant|en premier|avant tout|comptent? le plus|priorit/i;

const funnel = async (start, target) => {
    const rounds = [];
    for (let r = 0; r < MAX_ROUNDS; r++) {
        const {enough, questions} = await nextQuestions({start, rounds, language});
        if (enough) break;
        const reply = await ollamaJson(readerPrompt(target, questions, rounds.flat().map(q => q.free).filter(Boolean)));
        const answers = Array.isArray(reply?.answers) ? reply.answers : [];
        rounds.push(questions.map((q, i) => ({
            ...q,
            chosen: (Array.isArray(answers[i]?.chosen) ? answers[i].chosen : []).map(c => clean(c, 80)).filter(c => q.options.includes(c)),
            free: clean(answers[i]?.free, 400),
        })));
    }
    return {rounds, text: await writeProfile({start, rounds, language})};
};

// each interest given to its subject: {right, scored, lines}, and per subject whether one of its
// interests was found and all of them weighted right
const score = (interests, subjects) => {
    let right = 0, scored = 0;
    const bySubject = new Map(subjects.map(([name]) => [name, {found: false, right: true}]));
    const lines = interests.map(interest => {
        const matched = subjects.filter(([, pattern]) => pattern.test(interest.text));
        const head = `w=${interest.weight} ${interest.text.slice(0, 110)}`;
        if (matched.length !== 1) return `      ?  ${head}`;
        const [name, , main] = matched[0];
        const ok = main ? interest.weight === 1 : interest.weight < 1;
        scored++; if (ok) right++;
        const subject = bySubject.get(name);
        subject.found = true; subject.right &&= ok;
        return `      ${ok ? 'ok' : 'NO'} [${name}${main ? '' : ', secondary'}] ${head}`;
    });
    const count = (main, key) => subjects.filter(([name, , isMain]) => isMain === main && bySubject.get(name)[key] && bySubject.get(name).found).length;
    return {right, scored, lines, main: [count(true, 'right'), count(true, 'found')], secondary: [count(false, 'right'), count(false, 'found')],
        secondaries: subjects.filter(([, , main]) => !main).length};
};

const report = [];
const log = (line) => { console.log(line); report.push(line); };
const summary = [];

for (const name of names) {
    const {start, target, subjects} = CASES[name];
    log(`\n######## ${name}, start «${start}»`);
    const direct = score((await interestsOf({text: target, language, categories})).interests, subjects);
    log(`  direct split of the text: ${direct.right}/${direct.scored}`);
    direct.lines.forEach(line => log(line));
    const runs = [];
    for (let run = 1; run <= RUNS; run++) {
        const result = await funnel(start, target);
        const asked = result.rounds.flat().filter(q => IMPORTANCE.test(q.question));
        const split = score((await interestsOf({text: result.text, language, categories})).interests, subjects);
        runs.push({asked: asked.length > 0, ...split, questions: result.rounds.flat().length});
        log(`\n  === run ${run}: ${result.rounds.length} rounds, ${result.rounds.flat().length} questions, importance asked: ${asked.length ? 'yes' : 'no'}`);
        result.rounds.forEach((round, r) => round.forEach(q => log(`    [${r + 1}] ${q.question}${IMPORTANCE.test(q.question) ? '   <== importance' : ''}\n        choix: ${q.options.join(' ; ')}\n        coché: ${q.chosen.join(' ; ') || '-'}${q.free ? `\n        écrit: ${q.free}` : ''}`)));
        log(`    TEXT: ${result.text}`);
        log(`    weights right ${split.right}/${split.scored}`);
        split.lines.forEach(line => log(line));
    }
    const right = runs.reduce((s, r) => s + r.right, 0), scored = runs.reduce((s, r) => s + r.scored, 0);
    const sum = (key, i) => runs.reduce((s, r) => s + r[key][i], 0);
    summary.push(`${name}: interests weighted right ${right}/${scored}; main subjects at 1: ${sum('main', 0)}/${sum('main', 1)} found; `
        + `secondary subjects under 1: ${sum('secondary', 0)}/${sum('secondary', 1)} found of ${runs.reduce((s, r) => s + r.secondaries, 0)}; importance asked ${runs.filter(r => r.asked).length}/${runs.length}, `
        + `${(runs.reduce((s, r) => s + r.questions, 0) / runs.length).toFixed(1)} questions, direct split ${direct.right}/${direct.scored}`);
}
log('\n######## SUMMARY');
summary.forEach(line => log(line));
fs.writeFileSync(new URL(`./data/profile-importance-${LABEL}.txt`, import.meta.url), report.join('\n') + '\n');
process.exit(0);
