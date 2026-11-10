//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: briefing-audit.js
//  Description: A briefing already written, checked against what the regressions of the corpus (tests/regression) taught: the cards
//               in another language have their title and their text translated, no key point begins with a dateline, no name is
//               spelled with other accents than its card, no "If" of the analysis keeps a capital that is no name, no angle has a
//               language its title does not say. And, beside them, what a change may have broken without a sign: the share of cards
//               with their names, countries, angles, picture, AI version, and the time it took, against the last briefings of the
//               same profile, and why the cards without a country have none. Writes nothing. After a deploy, on the first briefing written
//
//  node scripts/briefing-audit.js <briefingId>     (exit code 1 when a check fails)
//  node scripts/briefing-audit.js <file.json> <profileId>     a briefing never saved (see bench/enzo-measure.mjs), its analysis and time aside
//

import 'dotenv/config';
import process from 'node:process';
import {readFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {MentionModel} from '../models/mention-model.js';
import {NO_COUNTRY_BECAUSE, countryInfoOf, whyNoCountry} from '../services/utils/countries.js';
import {lacksCapital, lowerFirst, capitalWordsOfCard} from '../services/utils/card-analysis.js';
import {cardChecks, short} from '../services/utils/briefing-checks.js';
import {UNCHECKED} from '../services/utils/original-marks.js';
import {readerLanguage, writtenIn} from '../services/utils/language.js';

// a briefing of the database by its id, or one never saved by its file (the cards as write() answers them, bench/enzo-measure.mjs saves
// them in bench/data/enzo-measure-<profile>-<n>-raw.json) and the profile it was written for
const [source, profileOfFile] = process.argv.slice(2);
const ofFile = Boolean(source) && !/^\d+$/.test(source);
const id = ofFile ? 2147483647 : Number(source);
if (!ofFile && !Number.isInteger(id) || ofFile && !Number.isInteger(Number(profileOfFile))) {
    console.error('node scripts/briefing-audit.js <briefingId>\nnode scripts/briefing-audit.js <file.json of the cards> <profileId>');
    process.exit(1);
}

const [row] = ofFile
    ? [{id: source, id_profile: Number(profileOfFile), created_at: null, finished_at: null, status: 'ready', items: JSON.parse(readFileSync(source, 'utf8')), analysis: null}]
    : await prisma.$queryRawUnsafe('SELECT id, id_profile, created_at, finished_at, status, items, analysis FROM briefings WHERE id = $1', id);
if (!row || row.status !== 'ready') {
    console.error(`The briefing ${source} is not a ready one.`);
    process.exit(1);
}
const profile = row.id_profile ? await ProfileModel.get(row.id_profile) : null;
const language = readerLanguage(profile ?? {});
const items = row.items ?? [];

// the checks that must hold: each lists what breaks it. The ones of the cards alone are the server's too (services/utils/briefing-checks.js, run after
// every briefing it writes); the ones of the analysis are written after the cards, they are here only
const foreign = items.filter(item => item.language && item.language !== language && writtenIn(item.language));
const angles = items.flatMap(item => (item.angles ?? []).map(angle => ({...angle, card: item.storyId})));
const checks = [
    ...cardChecks(items, language),
    ['no "If" of the analysis keeps a capital that is no name', Object.entries(row.analysis?.cards ?? {}).flatMap(([storyId, card]) => {
        const known = capitalWordsOfCard(items.find(item => String(item.storyId) === storyId));
        return (card.next ?? []).filter(line => lowerFirst(line.if, known) !== line.if).map(line => `If ${short(line.if, 50)}`);
    })],
    ['no part of an "If" line lacks the capital English gives a nationality, a month or a day', Object.values(row.analysis?.cards ?? {}).flatMap(card => (card.next ?? [])
        .flatMap(line => [line.if, line.then]).filter(part => lacksCapital(String(part ?? '').match(/^\p{L}+/u)?.[0])).map(part => short(part, 50)))],
];

let failed = 0;
console.log(`Briefing ${ofFile ? source : id} (profile ${row.id_profile}, reader ${language}): ${items.length} cards, ${foreign.length} in another language, ${angles.length} angles`);
// the sentences translated whose figures the check could not match to the original's, shown in italics with a warning (extract.js)
const warned = foreign.filter(item => String(item.translation ?? '').includes(UNCHECKED));
console.log(`${warned.length} card(s) with a sentence translated but marked ${UNCHECKED} (figures not matched)${warned.length > 0 ? `: ${warned.map(item => short(item.title, 40)).join(' | ')}` : ''}\n`);
for (const [name, broken] of checks) {
    console.log(`${broken.length === 0 ? 'ok  ' : 'FAIL'} ${name}${broken.length > 0 ? ` (${broken.length})` : ''}`);
    for (const one of broken.slice(0, 5)) console.log(`       - ${one}`);
    if (broken.length > 0) failed += 1;
}

// what a change may have broken without a sign: the share of the cards that have each thing, against the last briefings of the profile
const share = (list, test) => list.length === 0 ? 0 : Math.round(100 * list.filter(test).length / list.length);
const measures = (list) => ({
    names: share(list, item => item.names?.length), countries: share(list, item => item.countries?.length), angles: share(list, item => item.angles?.length),
    picture: share(list, item => item.thumbnail || item.illustration), aiPoints: share(list, item => item.ai?.points?.length), told: share(list, item => item.corroboration?.media > 1),
});
const before = row.id_profile ? await prisma.$queryRawUnsafe(
    `SELECT id, created_at, finished_at, items FROM briefings WHERE id_profile = $1 AND status = 'ready' AND id < $2 ORDER BY id DESC LIMIT 3`, row.id_profile, id) : [];
if (before.length > 0) {
    const now = {...measures(items), ...(ofFile ? {} : {seconds: Math.round((new Date(row.finished_at) - new Date(row.created_at)) / 1000)})};
    const average = (key) => Math.round(before.map(one => key === 'seconds' ? (new Date(one.finished_at) - new Date(one.created_at)) / 1000 : measures(one.items ?? [])[key]).reduce((a, b) => a + b, 0) / before.length);
    console.log(`\nagainst the ${before.length} briefings of before (% of the cards; seconds):`);
    for (const key of Object.keys(now)) {
        const was = average(key);
        const worse = key === 'seconds' ? now[key] > was * 1.5 : now[key] < was - 20;
        console.log(`${worse ? 'WARN' : '    '} ${key.padEnd(9)} ${String(now[key]).padStart(4)}  was ${String(was).padStart(4)}`);
    }
}
// the cards without a country, and why: a share that drops says nothing of what changed (international bodies have none by rule, a name
// the tagger did not link has none, a country the rules gave and the AI refused...). The names the card shows, their countries as read
// in the database
const withoutCountry = items.filter(item => !item.countries?.length);
if (withoutCountry.length > 0) {
    const qids = [...new Set(withoutCountry.flatMap(item => (item.names ?? []).map(name => name.qid)).filter(Boolean))];
    const countryOf = new Map((await MentionModel.countriesOf(qids)).map(one => [one.qid, countryInfoOf(one)]));
    const byReason = Map.groupBy(withoutCountry, item => whyNoCountry(item.names, countryOf));
    console.log(`\n${withoutCountry.length} of ${items.length} cards without a country:`);
    for (const [reason, text] of Object.entries(NO_COUNTRY_BECAUSE)) {
        const cards = byReason.get(reason) ?? [];
        if (cards.length === 0) continue;
        console.log(`    ${String(cards.length).padStart(3)}  ${text}`);
        for (const item of cards.slice(0, 2)) console.log(`           - ${short(item.titleTranslation ?? item.title, 60)}`);
    }
}
// what the last read of the AI took out of the cards, checked by the code (services/utils/proofread.js): each piece is a case for the corpus if the
// rules did not know it
const proofread = items.flatMap(item => (item.proofread ?? []).map(one => ({...one, card: item.titleTranslation ?? item.title})));
if (proofread.length > 0) {
    console.log(`\n${proofread.length} piece(s) the proofreading took out:`);
    for (const one of proofread.slice(0, 10)) console.log(`       - "${short(one.text, 60)}" (${one.kind}, ${one.fields.join(' and ')}) of "${short(one.card, 50)}"`);
}
// the names with no item of Wikidata that the AI said are no names (services/utils/name-review.js), left out of their card
const leftOut = items.flatMap(item => (item.namesLeftOut ?? []).map(one => ({...one, card: item.titleTranslation ?? item.title})));
if (leftOut.length > 0) {
    console.log(`\n${leftOut.length} name(s) with no item left out as no names:`);
    for (const one of leftOut.slice(0, 12)) console.log(`       - "${short(one.name, 40)}" (${one.why}) of "${short(one.card, 50)}"`);
}
// the pictures the AI found much better than the one the articles' order gave (services/utils/picture-choice.js): the picture shown and the one it replaced
const rechosen = items.filter(item => item.pictureChosen);
if (rechosen.length > 0) {
    console.log(`\n${rechosen.length} picture(s) chosen by the AI in place of the first one:`);
    for (const item of rechosen.slice(0, 10)) {
        const {shown, chosen} = item.pictureChosen.scores ?? {};
        console.log(`       - "${short(item.titleTranslation ?? item.title, 50)}": quality ${shown?.q} -> ${chosen?.q}, relevance ${shown?.r} -> ${chosen?.r} (${item.pictureChosen.fromSource ?? '?'} -> ${item.thumbnailSource ?? '?'})`);
    }
}
const rewritten = items.filter(item => item.titleRewritten).length;
const proposals = items.filter(item => item.titleProposal).length;
console.log(`\ntitles rewritten by the AI: ${rewritten}, rewrites left to the editor: ${proposals}, analysis: ${row.analysis?.status ?? 'none'} (${Object.keys(row.analysis?.cards ?? {}).length} cards)`);
console.log(failed > 0 ? `\n${failed} check(s) failed` : '\nAll the checks hold');
await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
