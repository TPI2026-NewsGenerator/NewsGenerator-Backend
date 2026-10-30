// Read only: a long profile (Roberto, 2366 characters) split into 4 interests, two of them cut at
// MAX_INTEREST_TEXT. The prompt of today against A (an interest is at most MAX_INTEREST_TEXT characters,
// split a subject that does not fit) and B (A, and who the reader reads for is no interest), on every
// profile of the database and of profile-texts.json, as interestsOf does it (one retry for the words
// left out). For each: interests, cut, words left out, and the share of the news of 48 h of a reference
// found (40 closest per interest): the stored interests, or for Roberto a split written by hand.
//   node --env-file=.env bench/split-long.mjs [runs] [variants, "today,A,B,code"] (ONLY=Roberto,Enzo)
import process from 'node:process';
import fs from 'node:fs';
import pg from 'pg';
import {embed, toVector} from '../services/utils/embedder.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {interestsOf, interestsPrompt, missingWords, normalizeInterests, MAX_INTEREST_TEXT, MAX_INTERESTS} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';

const RUNS = Number(process.argv[2] ?? 3);
const VARIANTS = (process.argv[3] ?? 'today,A,B').split(',');
const categories = FeedService.categories();

const TEXT_ANCHOR = `N'ajoute ni date, ni année, ni nom qu'il n'a pas écrit.`;
const SPLIT_ANCHOR = `mets-le dans "refused".`;
const RULE_A = ` Le "text" fait au plus ${MAX_INTEREST_TEXT} caractères : quand tout ce que le lecteur cite d'un sujet n'y tient pas, sépare ce sujet en plusieurs intérêts, chacun sur une partie qu'on lit dans les mêmes articles et nommant le sujet, ${MAX_INTERESTS} intérêts au plus en tout.`;
const RULE_B = `\nPour qui ou dans quel travail le lecteur lit (son poste, son employeur, la personne pour qui il fait cette veille) n'est pas un intérêt : seulement ce qu'il veut lire.`;
// the prompt of before the rule went into profile-ai.js (13.10.2026), and the code of now as it is
const BEFORE_RULE = / Le "text" fait au plus \d+ caractères[^\n]*?en tout\./;
const prompts = {
    today: (profile) => interestsPrompt(profile).replace(BEFORE_RULE, ''),
    A: (profile) => interestsPrompt(profile).replace(TEXT_ANCHOR, TEXT_ANCHOR + RULE_A),
    B: (profile) => interestsPrompt(profile).replace(TEXT_ANCHOR, TEXT_ANCHOR + RULE_A).replace(SPLIT_ANCHOR, SPLIT_ANCHOR + RULE_B),
};

// Roberto's profile split by hand: its words, each part of a subject read in the same articles
const ROBERTO = [
    "Refereeing across UEFA's 55 member associations: England, Spain, Italy, Germany, France and other leading European leagues, Italian refereeing, significant refereeing and VAR controversies, concrete incidents, statements, official complaints, institutional responses",
    'Referees and refereeing leaders: interviews and statements by European international referees and national refereeing leaders, changes to national heads of refereeing, refereeing committees and organisational structures',
    'Refereeing integrity: sanctions, disputes, investigations, scandals, integrity concerns and referee safety',
    'Laws of the Game and refereeing technology: IFAB decisions, VAR protocols, technology, training, assessment, professionalisation and working conditions, investment in VAR infrastructure, refereeing technology and development programmes',
    "International refereeing cooperation: referee exchanges, joint training, partnerships and shared expertise between countries or associations, foreign referees invited to another country's domestic league or cup, European referees officiating in Saudi Arabia, the UAE, Qatar and other Gulf countries",
    'UEFA, FIFA and national association governance developments affecting refereeing or UEFA',
];

// Enzo's too: its stored interests are cut themselves, they favour the split of before
const ENZO = [
    "Gouvernance du football : UEFA et ses 55 associations nationales, y compris les moins médiatisées, FIFA et autres confédérations, élections et changements de dirigeants dans les fédérations nationales et les instances du football, présidents, secrétaires généraux, directeurs généraux et responsables de l'arbitrage",
    'Crises du football : crises de gouvernance, conflits internes, affaires judiciaires, ingérences politiques et rapports de pouvoir dans les fédérations et les instances du football, relations internationales',
    "Arbitrage : évolutions de l'arbitrage et du VAR, Lois du Jeu de l'IFAB, désignations importantes, sanctions et controverses ayant des conséquences institutionnelles, finances, partenariats et sponsors potentiels pour l'arbitrage",
];

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const stored = (await db.query(`SELECT up.id, up.name, up.text, up.languages, array_agg(pi.text ORDER BY pi.position) AS interests
    FROM user_profiles up LEFT JOIN profile_interests pi ON pi.id_profile = up.id GROUP BY up.id ORDER BY up.id`)).rows;
const profiles = [
    ...stored.map(row => ({name: `${row.id} ${row.name}`, text: row.text, language: row.languages[0] ?? 'fr',
        reference: row.id === 137 ? ROBERTO : row.id === 7 ? ENZO : row.interests.filter(Boolean)})),
    ...JSON.parse(fs.readFileSync(new URL('./profile-texts.json', import.meta.url), 'utf8'))
        .map(row => ({name: row.name, text: row.text, language: row.languages[0], reference: []})),
].filter(p => !process.env.ONLY || process.env.ONLY.split(',').some(only => p.name.includes(only)));

const PER_INTEREST = 40;
const closestNews = async (texts) => {
    const sets = [];
    for (const vector of texts.length === 0 ? [] : await embed(texts)) {
        sets.push(new Set((await db.query(`SELECT id FROM articles WHERE embedded_at IS NOT NULL AND created_at > now() - interval '48 hours'
            ORDER BY text_dense <#> $1::halfvec LIMIT ${PER_INTEREST}`, [toVector(vector.dense)])).rows.map(row => Number(row.id))));
    }
    return sets;
};

// interestsOf with another prompt: the answer, the retry for the words left out, the longest text written
const split = async (prompt, profile) => {
    const answer = await ollamaJson(prompt);
    const interests = normalizeInterests(answer, {categories});
    const missing = missingWords(profile.text, interests, answer?.refused);
    let kept = {answer, interests, missing};
    if (missing.length > 0 && interests.length > 0) {
        const again = await ollamaJson([
            {role: 'user', content: prompt},
            {role: 'assistant', content: JSON.stringify(answer)},
            {role: 'user', content: `Ces mots du profil ne sont dans aucun "text" ni dans "refused" : ${missing.join(', ')}. Redonne toute ta réponse en ajoutant chacun, avec les mots qui l'entourent dans le profil, au "text" de l'intérêt qu'il précise, ou à "refused" si le lecteur le refuse. Ignore un mot qui ne dit aucun sujet.`},
        ]).catch(() => null);
        const retried = normalizeInterests(again, {categories});
        const left = missingWords(profile.text, retried, again?.refused);
        if (retried.length > 0 && left.length < missing.length) kept = {answer: again, interests: retried, missing: left};
    }
    const cut = (kept.answer?.interests ?? []).filter(i => typeof i?.text === 'string' && i.text.replace(/\s+/g, ' ').trim().length > MAX_INTEREST_TEXT).length;
    return {...kept, cut};
};

const jobs = profiles.flatMap(profile => VARIANTS.flatMap(variant => Array.from({length: RUNS}, (_, run) => ({profile, variant, run}))));
const now = async (profile) => {
    const {interests, refused} = await interestsOf({text: profile.text, language: profile.language, categories});
    return {answer: {refused}, interests, missing: missingWords(profile.text, interests, refused),
        cut: interests.filter(interest => interest.text.length >= MAX_INTEREST_TEXT).length};
};
const results = (await mapWithConcurrency(jobs, 4, ({profile, variant}) => variant === 'code' ? now(profile)
    : split(prompts[variant]({text: profile.text, language: profile.language, categories}), profile)))
    .map(result => result.status === 'fulfilled' ? result.value : {error: result.reason?.message});

for (const profile of profiles) {
    const referenceSets = await closestNews(profile.reference);
    const reference = new Set(referenceSets.flatMap(set => [...set]));
    console.log(`\n==== ${profile.name} (${profile.text.length} characters, reference ${profile.reference.length} interests, ${reference.size} news)`);
    for (const variant of VARIANTS) {
        for (const [i, job] of jobs.entries()) {
            if (job.profile !== profile || job.variant !== variant) continue;
            const result = results[i];
            if (result.error) { console.log(`-- ${variant}: error ${result.error}`); continue; }
            const sets = await closestNews(result.interests.map(interest => interest.text));
            const found = new Set(sets.flatMap(set => [...set]));
            const share = reference.size ? `${([...reference].filter(id => found.has(id)).length / reference.size * 100).toFixed(0)}%` : '-';
            const perReference = referenceSets.length > 1 ? ` [${referenceSets.map(set => ([...set].filter(id => found.has(id)).length / set.size * 100).toFixed(0)).join(' ')}]` : '';
            console.log(`-- ${variant} run ${job.run + 1}: ${result.interests.length} interests, ${result.cut} cut, news of the reference ${share}${perReference}`
                + `${result.missing.length ? `, missing: ${result.missing.join(', ')}` : ''}`
                + result.interests.map(interest => `\n      - (${interest.weight}) ${interest.text}\n        keywords: ${interest.keywords}\n        searches: ${interest.searches.join(', ')}`).join('')
                + `\n      refused: ${JSON.stringify(result.answer?.refused ?? [])}`);
        }
    }
}
await db.end();
process.exit(0);
