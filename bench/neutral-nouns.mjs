// The neutral title for the judgment NOUNS ("fiasco", "alarm") and the INJUNCTIONS of the medium ("UEFA and FIFA must react"), 06.11.2026.
// Two titles of a briefing stayed as published (a Serbian "Complete fiasco of Serbian football: ... UEFA and FIFA must react" and a
// Spanish "Alarma en el Betis por el árbitro ..."), both from the briefings 359 and 360 of 03.11.2026, before the AI rewrite existed.
// The judgment prompt listed adjectives, adverbs, marks and verbs, no noun and no injunction; the check of the rewrite refused a name
// lost with the clause of the injunction; the second opinion took the removal of "alarm" for a fact lost. Measured here:
//   1. the OLD judgment prompt (copied below) and the NEW one (neutral-titles.js) over the same titles of the cards of the last
//      days, in their own language as the pipeline reads them, each prompt run twice (the second time in the reverse order, other
//      batches) to tell what is noise of the judge from what is the prompt: which titles are flagged more, to be read by hand;
//   2. the whole pipeline (rewrittenTitle, thinking on, the checks, then sameFact, thinking on) on the titles newly flagged and
//      on hand-written ones: the two titles above in the languages they come in, others of the same kinds, and controls that must
//      stay as published (a rule stated as a fact, a quoted opinion, an event noun), each judged 4 times in a batch of 40;
//   3. pairs for the second opinion alone: an injunction dropped (should pass) and a fact dropped with names (must not).
//   JUDGE_ONLY=1 stops after the judgment (28 calls, no thinking), without the rewrites.
//   node --env-file=.env bench/neutral-nouns.mjs <out.json> [days=14] [max=300] [batch=40]
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import {checkRewrite, judgedTitles, normalizeJudged, rewrittenTitle, sameFact} from '../services/utils/neutral-titles.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {writtenIn} from '../services/utils/language.js';

const [out, days = 14, max = 300, batch = 40] = [process.argv[2], ...process.argv.slice(3).map(Number)];

// the judgment prompt as it was before 06.11.2026 (services/utils/neutral-titles.js)
const oldJudgmentPrompt = (titles) => `Voici des titres d'articles d'actualité, chacun avec son numéro entre crochets, dans leur langue d'origine.

Pour chaque titre, dis s'il contient un JUGEMENT, une EMPHASE ou un APPEL AU CLIC du média : un adjectif ou adverbe d'opinion ou d'intensité (« incroyable », « honteux », « énorme », « enfin », « massive », « shocking »), un point d'exclamation d'emphase, un mot d'appel (« Urgent », « Choc », « Révélation »), une question faite pour attirer, un mot en majuscules d'insistance, un verbe de combat (« démolit », « slams »).
N'en ont pas : un titre qui dit un fait en termes simples (même grave ou important), un titre qui rapporte ce que quelqu'un a dit entre guillemets (le jugement est celui de la personne citée, pas du média), un nom de rubrique ou de statut (« Officiel », « Interview », « Live »), un titre en question qui demande vraiment quelque chose d'ouvert à l'actualité.
Dans le doute, le titre n'en a pas.

${titles.map((title, i) => `[${i + 1}] ${title}`).join('\n')}

Réponds uniquement en JSON : {"titles": [{"n": numéro, "words": ["mot ou groupe de mots en cause, copié tel quel"]}]}`;
const oldJudged = async (titles, usage) => normalizeJudged(await ollamaJson(oldJudgmentPrompt(titles), usage), titles.length);

// ---- the cards of the last days
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [days]);
await client.end();
const cards = [...new Map(rows.flatMap(row => row.items).filter(item => item.title && item.summary).map(item => [item.title, item])).values()]
    .sort((a, b) => a.title < b.title ? -1 : 1);
// evenly spread over the sorted titles, the same from one run to the next
const sample = Array.from({length: Math.min(max, cards.length)}, (_, i) => cards[Math.floor(i * cards.length / Math.min(max, cards.length))]);
const text = (item) => [].concat(item.translation?.length ? item.translation : item.summary).join(' ');
const languageOf = (item) => writtenIn(item.language);
console.log(`${cards.length} cards, ${sample.length} in the sample`);

// ---- the hand-written titles: [title, passages, language, expected] (expected: 'change' or 'keep')
const real = (pattern) => cards.find(card => pattern.test(card.title));
const betis = real(/^Alarma en el Betis/);
const serbian = real(/^Potpuni fijasko srpskog fudbala/);
const handwritten = [
    // the two titles of the report, as they came and as the reader read them
    {title: 'Potpuni fijasko srpskog fudbala: Niko neće da bude predsednik FSS, moraju da reaguju UEFA i FIFA', passages: serbian ? text(serbian) : 'Niko neće da preuzme mesto predsednika Fudbalskog saveza Srbije. Savez nema predsednika posle ostavke.', language: 'Serbian', expect: 'change', note: 'real, Serbian Latin'},
    {title: 'Potpuni fiasko srpskog fudbala: Niko neće da bude predsednik FSS, UEFA i FIFA moraju da reaguju', passages: serbian ? text(serbian) : 'Niko neće da preuzme mesto predsednika Fudbalskog saveza Srbije.', language: 'Serbian', expect: 'change', note: 'Serbian Latin, injunction first'},
    {title: 'Потпуни фијаско српског фудбала: Нико неће да буде председник ФСС, УЕФА и ФИФА морају да реагују', passages: serbian ? text(serbian) : 'Нико неће да преузме место председника Фудбалског савеза Србије.', language: 'Serbian', expect: 'change', note: 'Serbian Cyrillic'},
    {title: 'Complete fiasco of Serbian football: No one wants to be president of the Football Association of Serbia, UEFA and FIFA must react', passages: serbian ? text(serbian) : 'No one wants to take the post of president of the Football Association of Serbia.', language: 'English', expect: 'change', note: 'as the reader read it'},
    {title: 'Alarma en el Betis por el árbitro elegido para la Champions... en el VAR', passages: betis ? text(betis) : 'La UEFA ha designado al árbitro del VAR para el partido de Champions del Betis.', language: 'Spanish', expect: 'change', note: 'real, Spanish'},
    {title: 'Alarma en el Real Betis por el árbitro elegido para la Champions... en el VAR', passages: betis ? text(betis) : 'La UEFA ha designado al árbitro del VAR para el partido de Champions del Betis.', language: 'Spanish', expect: 'change', note: 'Spanish, long name'},
    // other titles of the same two kinds (invented)
    {title: 'Federation in chaos: the national volleyball team lose 0-3 to Chile, the board must resign', passages: 'Chile beat the national volleyball team 3-0 in Santiago on Friday. The board of the federation has not commented.', language: 'English', expect: 'change', note: 'noun + injunction'},
    {title: 'Panique au port de Lorient : la nouvelle grille de pilotage inquiète les marins, l’État doit agir', passages: 'La nouvelle grille de pilotage du port de Lorient entre en vigueur lundi. Des marins s’inquiètent de la baisse des effectifs.', language: 'French', expect: 'change', note: 'noun + injunction'},
    {title: 'Debakel für den Handballverband: Trainer Müller tritt zurück, der Verband muss jetzt handeln', passages: 'Trainer Müller ist nach der Niederlage gegen Dänemark zurückgetreten. Der Verband sucht einen Nachfolger.', language: 'German', expect: 'change', note: 'noun + injunction'},
    {title: 'Farsa en la votación del consejo sobre el techo del estadio, el alcalde debería dimitir', passages: 'El consejo municipal aplazó la votación sobre el techo del estadio por falta de quórum.', language: 'Spanish', expect: 'change', note: 'noun + injunction'},
    // controls: facts, to stay as published
    {title: 'Clubs must register their squads by Friday, the league announced', passages: 'The league announced that clubs must register their squads by Friday.', language: 'English', expect: 'keep', note: 'a rule stated as a fact'},
    {title: 'Mourinho: UEFA must act on referee appointments', passages: 'Mourinho said at the press conference that UEFA must act on referee appointments.', language: 'English', expect: 'keep', note: 'what someone says, no quotes'},
    {title: 'Mourinho: “UEFA must act on referee appointments”', passages: 'Mourinho said at the press conference that UEFA must act on referee appointments.', language: 'English', expect: 'keep', note: 'what someone says, quoted'},
    {title: 'Fire destroys the main stand of the stadium in Lyon, 12 injured', passages: 'A fire destroyed the main stand of the stadium in Lyon on Sunday night. Twelve people were injured.', language: 'English', expect: 'keep', note: 'event noun'},
    {title: 'Le conseil d’administration doit se prononcer vendredi sur la vente du club', passages: 'Le conseil d’administration se réunit vendredi pour voter la vente du club.', language: 'French', expect: 'keep', note: 'a duty as a scheduled fact'},
    {title: 'Bankruptcy of the regional airline leaves 300 workers without pay', passages: 'The regional airline filed for bankruptcy on Monday. 300 workers have not been paid.', language: 'English', expect: 'keep', note: 'event noun'},
    {title: 'Players must wear shin guards in all matches from next season, federation says', passages: 'The federation says that from next season players must wear shin guards in all matches.', language: 'English', expect: 'keep', note: 'a rule stated as a fact'},
    {title: 'Teachers’ strike closes 40 schools in Valencia', passages: 'A strike of teachers closed 40 schools in Valencia on Tuesday.', language: 'English', expect: 'keep', note: 'event noun'},
    {title: 'Il faut trois victoires pour se qualifier, rappelle l’entraîneur', passages: 'L’entraîneur a rappelé que l’équipe a besoin de trois victoires pour se qualifier.', language: 'French', expect: 'keep', note: 'a requirement as a fact'},
    {title: 'Fans must show ID at the gate, the club says', passages: 'The club says fans must show ID at the gate from Saturday.', language: 'English', expect: 'keep', note: 'a rule stated as a fact'},
    {title: 'UEFA should publish the report, Ceferin says', passages: 'Ceferin said UEFA should publish the report.', language: 'English', expect: 'keep', note: 'what someone says, after'},
    {title: '"No club should be excluded" - the president of the league', passages: 'The president of the league said that no club should be excluded.', language: 'English', expect: 'keep', note: 'a whole title in quotes'},
    // the injunction first: its names are in the clause that starts the title, which the checks do not let go with it
    {title: 'UEFA and FIFA must react: nobody wants to lead the Hockey Federation of Norway', passages: 'Nobody has applied to lead the Hockey Federation of Norway.', language: 'English', expect: 'change', note: 'injunction first (names in it)'},
];
// pairs for the second opinion alone (A as published, B the proposal): ok = whether B tells the same fact
const pairs = [
    {title: 'Debacle for the national hockey team: Sweden win 6-1 in Riga, the federation and the IOC must react', proposal: 'Sweden win 6-1 against the national hockey team in Riga', ok: true, note: 'injunction dropped'},
    {title: 'Shocking collapse at the club: coach Silva sacked after the cup exit, Real Valencia name Garcia as successor', proposal: 'Coach Silva sacked after the cup exit', ok: false, note: 'fact dropped, with names'},
    {title: 'Chaos at the border: Poland closes the crossing at Terespol, Belarus retaliates with a trucks ban', proposal: 'Poland closes the crossing at Terespol', ok: false, note: 'fact dropped, with names'},
    {title: 'Scandale à la fédération : le président Durand est mis en examen, la ligue doit sanctionner', proposal: 'Le président Durand est mis en examen', ok: true, note: 'injunction dropped'},
    {title: 'Total debacle for the council: the mayor resigns, the governor of Texas appoints an administrator', proposal: 'The mayor resigns, the governor of Texas appoints an administrator', ok: true, note: 'noun dropped'},
    {title: 'Farce in the vote: the mayor resigns, the governor of Texas appoints an administrator', proposal: 'The mayor resigns', ok: false, note: 'fact dropped, with names'},
];

const usage = {oldJudging: newUsage(), newJudging: newUsage(), rewriting: newUsage(), verifying: newUsage(), pairs: newUsage()};
const chunks = (list, size) => Array.from({length: Math.ceil(list.length / size)}, (_, i) => list.slice(i * size, (i + 1) * size));

// ---- 1. the judgment, old and new, of the sample, then of the hand-written titles with titles of the sample
const run = async (titles, judge, tally) => {
    const flagged = new Map();
    const parts = chunks(titles.map((title, at) => ({title, at})), batch);
    const results = await mapWithConcurrency(parts, 4, async (part) => {
        for (const [at, words] of await judge(part.map(({title}) => title), tally)) flagged.set(part[at].at, words);
    });
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return flagged;
};
const titles = sample.map(item => item.title);
const [oldFlag, newFlag] = [await run(titles, oldJudged, usage.oldJudging), await run(titles, judgedTitles, usage.newJudging)];
const added = [...newFlag.keys()].filter(at => !oldFlag.has(at));
const removed = [...oldFlag.keys()].filter(at => !newFlag.has(at));
console.log(`old prompt: ${oldFlag.size} of ${titles.length} flagged; new prompt: ${newFlag.size}; newly flagged ${added.length}, no longer flagged ${removed.length}`);

// the noise of the judge itself: the same two prompts over the titles in the reverse order (other batches, other neighbours), so
// the differences between the two prompts can be read against the differences between two runs of one prompt
const reversed = titles.map((_, at) => titles.length - 1 - at);
const again = async (judge, tally) => {
    const flagged = await run(reversed.map(at => titles[at]), judge, tally);
    return new Map([...flagged].map(([at, words]) => [reversed[at], words]));
};
const [oldAgain, newAgain] = [await again(oldJudged, usage.oldJudging), await again(judgedTitles, usage.newJudging)];
const differ = (a, b) => [...a.keys()].filter(at => !b.has(at)).length;
console.log(`noise: old prompt run twice: ${oldFlag.size} / ${oldAgain.size} flagged, ${differ(oldFlag, oldAgain)} only in the first, ${differ(oldAgain, oldFlag)} only in the second; new prompt run twice: ${newFlag.size} / ${newAgain.size}, ${differ(newFlag, newAgain)} / ${differ(newAgain, newFlag)}`);
console.log(`new flagged in both runs: ${[...newFlag.keys()].filter(at => newAgain.has(at)).length}; of the ${added.length} newly flagged, flagged again by the new prompt: ${added.filter(at => newAgain.has(at)).length}, by the old prompt in its second run: ${added.filter(at => oldAgain.has(at)).length}`);

// what is not noise: flagged by a prompt in both of its runs and by the other in neither
const flaggedTwice = (a, b) => [...a.keys()].filter(at => b.has(at));
const never = (at, ...maps) => maps.every(map => !map.has(at));
const stableAdded = flaggedTwice(newFlag, newAgain).filter(at => never(at, oldFlag, oldAgain));
const stableRemoved = flaggedTwice(oldFlag, oldAgain).filter(at => never(at, newFlag, newAgain));
console.log(`flagged by both runs of the old prompt and by none of the new: ${stableRemoved.length}; by both runs of the new prompt and by none of the old: ${stableAdded.length}`);
for (const at of stableRemoved) console.log(`  only old: ${titles[at]}   ${JSON.stringify(oldFlag.get(at))}`);
for (const at of stableAdded) console.log(`  only new: ${titles[at]}   ${JSON.stringify(newFlag.get(at))}`);
// the titles of the sample with a mark of the two new kinds (a noun that judges, a "must"), and what each prompt did with them
const KINDS = /\b(fiasco|fijasko|scandal|escándalo|scandale|chaos|caos|debacle|débâcle|debakel|farce|farsa|disgrace|shame|honte|alarm|alarma|alarme|panic|panique|nightmare|catastrophe|catástrofe|must|should|doit|doivent|il faut|debe|deben|debería|muss|sollte|moraju|treba)\b/iu;
const marked = titles.map((title, at) => ({title, at})).filter(({title}) => KINDS.test(title));
console.log(`\n${marked.length} titles of the sample have a mark of the new kinds (flags: old run 1/2, new run 1/2):`);
for (const {title, at} of marked) console.log(`  ${[oldFlag, oldAgain, newFlag, newAgain].map(map => map.has(at) ? 'x' : '.').join('')}  ${title}`);

// the hand-written titles in a batch of 40 with titles of the sample, 4 times with other neighbours: how often each is flagged
const REPEATS = 4;
const mixedBatch = (r) => {
    const filler = Array.from({length: batch - handwritten.length}, (_, i) => sample[(r * 37 + i * 7 + 3) % sample.length].title);
    return [...handwritten.map(({title}) => title), ...filler];
};
const flaggedBy = {old: handwritten.map(() => 0), new: handwritten.map(() => 0)};
let oldHand;
let newHand;
for (let r = 0; r < REPEATS; r++) {
    const [oldNow, newNow] = [await run(mixedBatch(r), oldJudged, usage.oldJudging), await run(mixedBatch(r), judgedTitles, usage.newJudging)];
    handwritten.forEach((_, at) => { flaggedBy.old[at] += oldNow.has(at) ? 1 : 0; flaggedBy.new[at] += newNow.has(at) ? 1 : 0; });
    if (r === 0) [oldHand, newHand] = [oldNow, newNow];
}
if (process.env.JUDGE_ONLY) {
    handwritten.forEach(({title, expect: wanted}, at) => console.log(`  ${flaggedBy.old[at]}/${REPEATS} old, ${flaggedBy.new[at]}/${REPEATS} new (${wanted})  ${title}`));
    console.log(`tokens ${JSON.stringify(usage)}`);
    process.exit(0);
}

// ---- 2. the pipeline on the titles flagged by the new prompt and not by the old one, and on the hand-written ones the new prompt flagged
const entries = [
    ...added.map(at => ({source: 'sample', title: sample[at].title, passages: text(sample[at]), language: languageOf(sample[at]), words: newFlag.get(at)})),
    ...handwritten.map((entry, at) => ({source: 'hand', ...entry, oldFlagged: flaggedBy.old[at], newFlagged: newHand.has(at), flaggedNew: flaggedBy.new[at], words: newHand.get(at) ?? null})),
];
// the hand-written ones are rewritten even when the new prompt did not flag them (to see what the rewrite and the checks do with them)
const toRewrite = entries.filter(entry => entry.source === 'sample' || entry.newFlagged || entry.expect === 'change');
await mapWithConcurrency(toRewrite, 4, async (entry) => {
    try {
        const answer = await rewrittenTitle(entry.title, entry.passages, usage.rewriting, {language: entry.language, timeoutMs: 240e3});
        entry.status = answer.title ? 'proposed' : answer.reason;
        entry.proposal = answer.title ?? answer.proposal ?? null;
        entry.problem = answer.problem ?? null;
        entry.dropped = answer.dropped ?? null;
    } catch (err) {
        entry.status = 'failed';
        entry.problem = err.message;
    }
});
const proposed = toRewrite.filter(entry => entry.status === 'proposed');
await mapWithConcurrency(chunks(proposed, 6), 4, async (part) => {
    try {
        const verdicts = await sameFact(part.map(({title, proposal, dropped}) => ({title, proposal, dropped})), usage.verifying, {think: true, timeoutMs: 300e3});
        part.forEach((entry, at) => { entry.same = verdicts.get(at) ?? null; });
    } catch (err) {
        part.forEach(entry => { entry.same = {same: null, why: `failed: ${err.message}`}; });
    }
});

// ---- 3. the second opinion alone
const withDropped = pairs.map(pair => ({...pair, dropped: checkRewrite(pair.title, pair.proposal, '').dropped, code: checkRewrite(pair.title, pair.proposal, '').problem ?? 'passes'}));
const verdicts = await sameFact(withDropped, usage.pairs, {think: true, timeoutMs: 300e3});
withDropped.forEach((pair, at) => { pair.verdict = verdicts.get(at) ?? null; });

// ---- the report
const line = (entry) => [
    `[${entry.source}${entry.note ? `, ${entry.note}` : ''}${entry.expect ? `, expected ${entry.expect}` : ''}]${entry.source === 'hand' ? ` flagged by the old prompt ${entry.oldFlagged}/${REPEATS}, by the new ${entry.flaggedNew}/${REPEATS}` : ''}`,
    `   ${entry.title}`,
    entry.words ? `   words: ${JSON.stringify(entry.words)}` : null,
    entry.status ? `   rewrite: ${entry.status}${entry.problem ? ` (${entry.problem})` : ''}${entry.proposal ? `\n   -> ${entry.proposal}` : ''}${entry.dropped ? `\n   dropped: ${JSON.stringify(entry.dropped)}` : ''}` : null,
    entry.same ? `   second opinion: ${entry.same.same} ${entry.same.why}` : null,
].filter(Boolean).join('\n');
console.log('\n=== hand-written');
for (const entry of entries.filter(e => e.source === 'hand')) console.log(`\n${line(entry)}`);
console.log('\n=== newly flagged in the sample');
for (const entry of entries.filter(e => e.source === 'sample')) console.log(`\n${line(entry)}`);
console.log('\n=== no longer flagged in the sample');
for (const at of removed) console.log(`  ${sample[at].title}   ${JSON.stringify(oldFlag.get(at))}`);
console.log('\n=== pairs for the second opinion');
for (const pair of withDropped) console.log(`\n[${pair.note}, expected ${pair.ok}] code: ${pair.code}\n   A: ${pair.title}\n   B: ${pair.proposal}\n   dropped: ${JSON.stringify(pair.dropped ?? null)}\n   verdict: ${pair.verdict?.same} ${pair.verdict?.why ?? ''}`);
const count = (list, key) => list.reduce((all, entry) => ({...all, [entry[key]]: (all[entry[key]] ?? 0) + 1}), {});
const kept = entries.filter(entry => entry.same?.same === true);
console.log(`\nsample: ${titles.length} titles, old prompt flagged ${oldFlag.size}, new prompt ${newFlag.size}, newly flagged ${added.length}; sample rewrites ${JSON.stringify(count(entries.filter(e => e.source === 'sample'), 'status'))}, blocked by ${JSON.stringify(count(entries.filter(e => e.source === 'sample' && e.problem), 'problem'))}`);
console.log(`hand-written: ${handwritten.length}, rewrites ${JSON.stringify(count(entries.filter(e => e.source === 'hand'), 'status'))}, kept after the second opinion: ${kept.filter(e => e.source === 'hand').length}`);
console.log(`tokens ${JSON.stringify(usage)}`);
fs.writeFileSync(out, JSON.stringify({sample: titles.length, oldFlagged: [...oldFlag], newFlagged: [...newFlag], added, removed, entries, withDropped, usage}, null, 1));
console.log(`written to ${out}`);
