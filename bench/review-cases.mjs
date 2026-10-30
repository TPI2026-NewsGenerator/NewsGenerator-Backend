// The cards the review of a briefing reads (see reviewCards), gathered to replay it: briefings of
// readers written live and never saved (as bench/briefing-relevance.mjs), every call of the review
// recorded with its cards (title and passages) and the ones it left out. Read only.
//   node --env-file=.env bench/review-cases.mjs <out.json> <hours> userId...
import {existsSync, readFileSync, writeFileSync} from 'node:fs';

const [out, hoursArg, ...userArgs] = process.argv.slice(2);
const hours = Number(hoursArg);

// the calls of the review, recorded before the client of Ollama takes fetch (at its import)
const reviews = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
    const response = await realFetch(url, options);
    if (!/ollama\.com/.test(String(url?.url ?? url))) return response;
    const prompt = JSON.parse(options.body).messages?.[0]?.content ?? '';
    if (prompt.includes('Voici les cartes de son résumé')) {
        reviews.push({prompt, answer: (await response.clone().json()).message?.content ?? null});
    }
    return response;
};

const {write} = await import('../services/briefing-service.js');
const {BriefingModel} = await import('../models/briefing-model.js');
const {DiscoveryService} = await import('../services/discovery-service.js');
const {ProfileModel} = await import('../models/profile-model.js');
BriefingModel.step = async () => {};
DiscoveryService.prune = async () => {};

// the cards of a prompt of the review: "[id] title\npassages", separated by an empty line
const cardsOf = (prompt) => {
    const block = prompt.split('et le résumé de son article :\n')[1].split('\n\nLe résumé dit de quoi')[0];
    return block.split(/\n\n(?=\[\d+\] )/).map(card => {
        const [, id, title, summary] = card.match(/^\[(\d+)\] (.*)\n([\s\S]*)$/);
        return {id, title, summary: summary === '(pas de résumé)' ? null : summary};
    });
};

const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
const log = console.log;
for (const userId of userArgs.map(Number)) {
    reviews.length = 0;
    console.log = () => {};
    const items = await write(null, userId, hours).catch(err => ({error: err.message}));
    console.log = log;
    const profile = await ProfileModel.get(userId);
    for (const review of reviews) {
        let leftOut = {};
        try {
            leftOut = Object.fromEntries((JSON.parse(review.answer.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')).refused ?? [])
                .map(item => [String(item.id).replace(/^\[|\]$/g, ''), item.why]));
        } catch { /* no JSON */ }
        result.push({userId, profile: profile.text, at: new Date().toISOString(),
            cards: cardsOf(review.prompt).map(card => ({...card, leftOut: leftOut[card.id] ?? null}))});
    }
    log(`user ${userId}: ${Array.isArray(items) ? items.length : items.error} cards, ${reviews.length} reviews, ${reviews.reduce((n, r) => n + (r.answer?.match(/"id"/g)?.length ?? 0), 0)} left out`);
    writeFileSync(out, JSON.stringify(result, null, 1));
}
process.exit(0);
