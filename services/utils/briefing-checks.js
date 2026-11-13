//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: briefing-checks.js
//  Description: The checks of a briefing that need nothing but its cards, what the regressions of the corpus (tests/regression) taught: the
//               cards in another language have their title and their text translated, no text a reader sees is written in another
//               language than theirs (read from its letters), no key point begins with a dateline or is a photo caption, no title keeps
//               the label of a paywall, no name is spelled with other accents than its card, no angle has a language its title does not
//               say. Run by scripts/briefing-audit.js on a briefing already written, and by the server on every briefing it writes (see
//               logBriefingChecks): the reader should not be the first to see what a check sees. No AI, nothing is changed
//

"use strict"

import {isPhotoCaption, withoutDateline} from './extract.js';
import {ORIGINAL_START} from './original-marks.js';
import {scriptLanguage, shownLanguage, titleLanguage, writtenIn} from './language.js';
import {withoutAccessLabel} from './neutral-titles.js';
import {mapWithConcurrency} from './concurrency.js';
import {whyNotShown} from './picture-sizes.js';

const plain = (word) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const short = (text, n = 70) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);
// the first paragraph (a passage) of a text of a card, and its first sentence
const firstOf = (text) => String(text ?? '').split(/\n\n/)[0];

// [[name of the check, [what breaks it]]] for the cards of a briefing written for a reader of 'language' (a code)
export const cardChecks = (items, language) => {
    const foreign = items.filter(item => item.language && item.language !== language && writtenIn(item.language));
    const angles = items.flatMap(item => (item.angles ?? []).map(angle => ({...angle, card: item.storyId})));
    const foreignAngles = angles.filter(angle => angle.language && angle.language !== language && writtenIn(angle.language));
    const TEXT_FIELDS = ['summary', 'points', 'digest', 'translation', 'pointsTranslation', 'digestTranslation'];
    return [
        ['the title of a card in another language is translated', foreign.filter(item => !item.titleTranslation).map(item => `[${item.language}] ${short(item.title)}`)],
        ['the text of a card in another language is translated', foreign.filter(item => item.summary && !item.translation).map(item => `[${item.language}] ${short(item.title)}`)],
        ['the key points of a card in another language are translated', foreign.filter(item => item.points && !item.pointsTranslation).map(item => `[${item.language}] ${short(item.title)}`)],
        ['the digest of a card in another language is translated', foreign.filter(item => item.digest && !item.digestTranslation).map(item => `[${item.language}] ${short(item.title)}`)],
        // what the reader SEES, read from its own letters and not from the label a feed gave the news (a Persian title of an English feed passed the checks
        // above, 9.11.2026): the title, the passages, the key points, the digest and the titles of the other angles are written in the reader's language
        ['no text a reader sees is written in another language than theirs', items.flatMap(item => [
            ['title', item.titleTranslation ?? item.title], ['passages', item.translation ?? item.summary], ['key points', item.pointsTranslation ?? item.points],
            ['digest', item.digestTranslation ?? item.digest], ...(item.angles ?? []).map(angle => ['angle title', angle.titleTranslation ?? angle.title]),
        ].filter(([, text]) => text && String(text).length >= 12).map(([field, text]) => [field, text, shownLanguage(firstOf(text))])
            .filter(([, , written]) => written && written !== language)
            .map(([field, text, written]) => `[${written}] ${field}: ${short(text, 50)}`))],
        // the rest of what a card shows in sentences: the line that tells why it was chosen, the version written by the AI, the sentence of someone who denies
        // the news, the statement of a party, the card it follows, the words an article used to say it has no confirmation
        ['no other sentence a reader sees is written in another language than theirs', items.flatMap(item => [
            ['why', item.why], ...(item.ai?.points ?? []).map(point => ['AI points', point]), ['AI summary', item.ai?.summary],
            ...(item.contested ?? []).map(denial => ['denial', denial.translation ?? denial.sentence]),
            ...(item.official ?? []).map(post => ['statement', post.translation ?? post.title]),
            ['follow-up', item.followUp?.title], ['unconfirmed', item.hedgedTranslation ?? item.hedged],
        ].filter(([, text]) => text && String(text).length >= 12).map(([field, text]) => [field, text, shownLanguage(firstOf(text))])
            .filter(([, , written]) => written && written !== language)
            .map(([field, text, written]) => `[${written}] ${field}: ${short(text, 50)} (${short(item.titleTranslation ?? item.title, 30)})`))],
        // a name is not translated, it is spelled: a chip in the letters of another language (Cyrillic for "Gianni Infantino") is a name Wikidata could spell
        // in the language of the reader
        ['no name a reader sees is written in the letters of another language than theirs', items.flatMap(item => (item.names ?? [])
            .filter(name => { const written = scriptLanguage(name.name, language); return written && written !== language; })
            .map(name => `[${scriptLanguage(name.name, language)}] ${name.name} (${short(item.titleTranslation ?? item.title, 40)})`))],
        ['the title of an angle in another language is translated', foreignAngles.filter(angle => !angle.titleTranslation).map(angle => `[${angle.language}] ${short(angle.title)}`)],
        ['no sentence of a translation is left in the language of the article', foreign.filter(item => [item.translation, item.pointsTranslation, item.digestTranslation]
            .some(text => String(text ?? '').includes(`${ORIGINAL_START}(`))).map(item => `[${item.language}] ${short(item.title)}`)],
        ['every card has a picture', items.filter(item => !item.thumbnail && !item.illustration).map(item => short(item.titleTranslation ?? item.title))],
        ['no key point begins with a dateline', items.flatMap(item => TEXT_FIELDS.map(field => firstOf(item[field])).filter(first => withoutDateline(first) !== first).map(first => short(first)))],
        ['no key point is the caption of a photo', items.flatMap(item => TEXT_FIELDS.map(field => firstOf(item[field])).filter(first => isPhotoCaption(first)).map(first => short(first)))],
        ['no title keeps the label of a paywall', items.flatMap(item => [item.title, item.titleTranslation].filter(title => title && withoutAccessLabel(title) !== title).map(title => short(title, 80)))],
        ['no name is spelled with other accents than its card', items.flatMap(item => {
            const names = new Map((item.names ?? []).flatMap(name => String(name.name ?? '').split(/\s+/)).filter(word => /^\p{Lu}/u.test(word) && word.length >= 5).map(word => [plain(word), word]));
            const text = [item.titleTranslation, item.translation, item.pointsTranslation, item.digestTranslation].filter(Boolean).join('\n');
            return (text.match(/\p{L}[\p{L}\p{M}'’-]*\p{L}/gu) ?? []).map(word => word.replace(/['’]s$/, ''))
                .filter(word => /^\p{Lu}/u.test(word) && word !== word.toUpperCase() && names.has(plain(word)) && names.get(plain(word)) !== word)
                .map(word => `"${word}" for "${names.get(plain(word))}" (${short(item.titleTranslation ?? item.title, 40)})`);
        })],
        ['no angle has a language its title does not say', angles.filter(angle => angle.language && (() => {
            const read = titleLanguage(angle.title, angle.language);
            return read.language !== angle.language && !read.guessed;
        })()).map(angle => `[${angle.language} for ${titleLanguage(angle.title, angle.language).language}] ${short(angle.title, 60)}`)],
    ];
};

// The check that needs the network: [[name, [what breaks it]]] for the pictures the cards show. A picture a browser on the page of a reader would show none of (an address that answers an error,
// no image, a site that forbids the others to show its pictures) is a card the reader sees without a picture though the data holds one: "every card has a picture" cannot see it.
// probe(url): why it would not show (see whyNotShown), null when it would, undefined when it could not be told (said nothing). Each address once, eight at a time
const askPictures = async (items, probe) => {
    const urls = [...new Set(items.map(item => item.thumbnail).filter(Boolean))];
    const reasons = new Map();
    const results = await mapWithConcurrency(urls, 8, async (url) => { reasons.set(url, await probe(url)); });
    // a probe that breaks is a mistake of the code, not a picture that cannot be told: it is said
    const broke = results.find(result => result.status === 'rejected');
    if (broke) throw broke.reason;
    return reasons;
};
const pictureCheck = (items, reasons) => ['every picture a card shows loads on the page of a reader',
    items.filter(item => item.thumbnail && reasons.get(item.thumbnail)).map(item => `${short(item.titleTranslation ?? item.title, 50)}: ${reasons.get(item.thumbnail)}`)];
export const pictureLoadChecks = async (items, probe = whyNotShown) => [pictureCheck(items, await askPictures(items, probe))];

// The same line in the log for the pictures, asked after the briefing is written and never waited on (about a request for each picture). Never throws
export const logPictureChecks = async (label, items, log = console, probe = whyNotShown) => {
    try {
        const reasons = await askPictures(items, probe);
        const failed = [pictureCheck(items, reasons)].filter(([, broken]) => broken.length > 0)
            .map(([name, broken]) => ({name, count: broken.length, examples: broken.slice(0, 2)}));
        // the addresses that could not be told (too slow, a refusal aimed at robots) are said, not counted as loading
        const untold = [...reasons.values()].filter(reason => reason === undefined).length;
        if (failed.length === 0) log.log(`Briefing ${label}: audit: every picture of the cards loads${untold > 0 ? ` (${untold} could not be told)` : ''}`);
        else log.error(`Briefing ${label}: audit: ${failed.map(one => `${one.name} (${one.count}: ${one.examples.join(' | ')})`).join('; ')}`);
        return failed;
    } catch (err) {
        log.error(`Briefing ${label}: the audit of the pictures failed (${err.message})`);
        return [];
    }
};

// A line for the log of the server: the checks of the cards of a briefing it has just written, the ones that fail named with their count and
// their first example. Never throws, never changes the briefing: the audit is to be seen, not to be waited on. 'label': the id of the
// briefing (or "unsaved"); answers the list of the checks that failed, [{name, count, examples}]
export const logBriefingChecks = (label, items, language, log = console) => {
    try {
        const failed = cardChecks(items, language).filter(([, broken]) => broken.length > 0)
            .map(([name, broken]) => ({name, count: broken.length, examples: broken.slice(0, 2)}));
        if (failed.length === 0) log.log(`Briefing ${label}: audit: all the checks of the cards hold (${items.length} cards)`);
        else log.error(`Briefing ${label}: audit: ${failed.length} checks of the cards fail: ${failed.map(one => `${one.name} (${one.count}: ${one.examples.join(' | ')})`).join('; ')}`);
        return failed;
    } catch (err) {
        log.error(`Briefing ${label}: the audit of the cards failed (${err.message})`);
        return [];
    }
};
