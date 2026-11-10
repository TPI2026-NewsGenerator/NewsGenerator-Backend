//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: positions-mock.js
//  Description: The fixed answers of /api/v1 until the positions are really computed (a friend builds the map of
//               the 211 associations on them): made-up associations only, never a position said of a real one,
//               a screenshot of a map must not pass for a fact. It holds every case of the contract: the five
//               positions, a reversal, a position weakened, one gone stale, a rumour, a speaker who does not
//               bind the association, a candidate whose reading is still running, the confederations
//

"use strict"

// the "now" of the mock: the answers do not change from one day to the next, so a test can count on them
export const NOW = '2026-11-10T21:00:00Z';

const INFANTINO = 'Q124138';

export const SUBJECTS = [
    {qid: INFANTINO, name: 'Gianni Infantino', status: 'incumbent', status_since: null, state: 'ready', news_30d: 8103},
    {qid: 'Q000010', name: 'Candidat Exemple A', status: 'declared', status_since: '2026-11-05', state: 'ready', news_30d: 1027},
    {qid: 'Q000011', name: 'Candidat Exemple B', status: 'rumoured', status_since: '2026-10-29', state: 'computing', news_30d: 0},
];

// fifa: the code of the association (the made-up ones start with X), level: a confederation votes no
export const ASSOCIATIONS = [
    {qid: 'Q000001', fifa: 'XXA', name: 'Fédération Exemple A', confederation: 'UEFA', level: 'association'},
    {qid: 'Q000002', fifa: 'XXB', name: 'Fédération Exemple B', confederation: 'CAF', level: 'association'},
    {qid: 'Q000003', fifa: 'XXC', name: 'Fédération Exemple C', confederation: 'UEFA', level: 'association'},
    {qid: 'Q000004', fifa: 'XXD', name: 'Fédération Exemple D', confederation: 'AFC', level: 'association'},
    {qid: 'Q000005', fifa: 'XXE', name: 'Fédération Exemple E', confederation: 'CONCACAF', level: 'association'},
    {qid: 'Q000006', fifa: 'XXF', name: 'Fédération Exemple F', confederation: 'CONMEBOL', level: 'association'},
    {qid: 'Q000007', fifa: 'XXG', name: 'Fédération Exemple G', confederation: 'OFC', level: 'association'},
    {qid: 'Q000008', fifa: 'XXH', name: 'Fédération Exemple H', confederation: 'UEFA', level: 'association'},
    {qid: 'Q000009', fifa: 'XXI', name: 'Fédération Exemple I', confederation: 'CAF', level: 'association'},
    // Q000010 and Q000011 are the made-up candidates above: no two things share a QID
    {qid: 'Q000012', fifa: 'XXJ', name: 'Fédération Exemple J', confederation: 'AFC', level: 'association'},
    {qid: 'Q000101', fifa: 'XCU', name: 'Confédération Exemple 1', confederation: 'UEFA', level: 'confederation'},
    {qid: 'Q000102', fifa: 'XCA', name: 'Confédération Exemple 2', confederation: 'AFC', level: 'confederation'},
];

// a signal as the fiche gives it, newest first; the target is the subject it is kept under (see positions-service.js)
const signal = ({id, date, stance, mark, name = 'Prénom Nom', role, binds, sentence, lang, translations = {}, article, news, media, at}) => ({
    id, date, stance, mark,
    speaker: {name, qid: null, role, binds},
    sentence, lang, translations,
    url: `https://exemple.org/article-${article}`, medium: 'exemple.org', published_at: at,
    news, media,
});

const PRESIDENT = 'président de la fédération';
const ANONYMOUS = {name: null, role: 'source anonyme', binds: false};
const rumour = (fields) => signal({...fields, role: ANONYMOUS.role, binds: false, name: null});

// subject -> fifa code -> {position, since, previous, confidence, total?, signals}: no entry is "inconnue"
export const POSITIONS = {
    [INFANTINO]: {
        // the reversal of the doc: declared support in October, declared opposition on 8 November
        XXA: {
            position: 'non_soutien_declare', since: '2026-11-08', previous: {position: 'soutien_declare', since: '2026-10-14'}, confidence: 'high', total: 6,
            signals: [
                signal({id: 'sig_0002', date: '2026-11-08', stance: 'against', mark: 'official', role: PRESIDENT, binds: true, lang: 'fr', article: 2, news: 7, media: 5, at: '2026-11-08T09:12:00Z',
                    sentence: 'Exemple fictif : la fédération ne soutiendra pas un nouveau mandat.',
                    translations: {en: 'Example only: the federation will not back a new term.'}}),
                signal({id: 'sig_0001', date: '2026-10-14', stance: 'for', mark: 'official', role: PRESIDENT, binds: true, lang: 'en', article: 1, news: 3, media: 3, at: '2026-10-14T16:40:00Z',
                    sentence: 'Example only: the federation backs the current president.',
                    translations: {fr: 'Exemple seulement : la fédération soutient le président actuel.'}}),
            ],
        },
        XXC: {
            position: 'soutien_declare', since: '2026-11-06', previous: null, confidence: 'high',
            signals: [
                signal({id: 'sig_0010', date: '2026-11-06', stance: 'for', mark: 'official', name: 'Nom Exemple', role: PRESIDENT, binds: true, lang: 'fr', article: 3, news: 2, media: 2, at: '2026-11-06T08:00:00Z',
                    sentence: "Exemple fictif : la fédération annonce sur son site qu'elle soutient la réélection.",
                    translations: {en: 'Example only: the federation announces on its site that it backs the re-election.'}}),
            ],
        },
        // a vice-president speaks, not the association: only "probable"
        XXD: {
            position: 'soutien_probable', since: '2026-10-28', previous: null, confidence: 'medium',
            signals: [
                signal({id: 'sig_0020', date: '2026-10-28', stance: 'for', mark: 'official', name: 'Autre Nom', role: 'vice-président', binds: false, lang: 'en', article: 4, news: 4, media: 3, at: '2026-10-28T11:30:00Z',
                    sentence: 'Example only: the vice-president says he would back the incumbent.',
                    translations: {fr: 'Exemple seulement : le vice-président dit qu\'il soutiendrait le sortant.'}}),
            ],
        },
        // a rumour: "probable" at most, whatever the number of papers
        XXE: {
            position: 'non_soutien_probable', since: '2026-10-29', previous: null, confidence: 'low',
            signals: [
                rumour({id: 'sig_0030', date: '2026-10-29', stance: 'against', mark: 'reported', lang: 'fr', article: 5, news: 1, media: 1, at: '2026-10-29T14:05:00Z',
                    sentence: 'Exemple fictif : la fédération aurait décidé de ne pas le soutenir, selon une source.',
                    translations: {en: 'Example only: the federation is said to have decided not to back him, according to a source.'}}),
            ],
        },
        // said once, a long time ago: the position stays, marked stale
        XXG: {
            position: 'soutien_declare', since: '2026-07-01', previous: null, confidence: 'medium',
            signals: [
                signal({id: 'sig_0040', date: '2026-07-01', stance: 'for', mark: 'official', role: PRESIDENT, binds: true, lang: 'fr', article: 6, news: 2, media: 2, at: '2026-07-01T10:00:00Z',
                    sentence: 'Exemple fictif : la fédération soutient le président actuel.',
                    translations: {en: 'Example only: the federation backs the current president.'}}),
            ],
        },
        // declared support, then only thanks: weakened, same side
        XXH: {
            position: 'soutien_probable', since: '2026-11-02', previous: {position: 'soutien_declare', since: '2026-09-20'}, confidence: 'medium',
            signals: [
                signal({id: 'sig_0051', date: '2026-11-02', stance: 'for', mark: 'official', role: PRESIDENT, binds: true, lang: 'fr', article: 7, news: 2, media: 2, at: '2026-11-02T09:00:00Z',
                    sentence: 'Exemple fictif : la fédération remercie le président pour son action.',
                    translations: {en: 'Example only: the federation thanks the president for his work.'}}),
                signal({id: 'sig_0050', date: '2026-09-20', stance: 'for', mark: 'official', role: PRESIDENT, binds: true, lang: 'fr', article: 8, news: 2, media: 2, at: '2026-09-20T09:00:00Z',
                    sentence: 'Exemple fictif : la fédération soutient le président actuel.',
                    translations: {en: 'Example only: the federation backs the current president.'}}),
            ],
        },
        XCU: {
            position: 'non_soutien_probable', since: '2026-10-29', previous: null, confidence: 'medium',
            signals: [
                signal({id: 'sig_0060', date: '2026-10-29', stance: 'against', mark: 'official', name: 'Nom Exemple', role: 'président de la confédération', binds: true, lang: 'en', article: 9, news: 12, media: 8, at: '2026-10-29T12:00:00Z',
                    sentence: 'Example only: the confederation looks for a challenger.',
                    translations: {fr: 'Exemple seulement : la confédération cherche un challenger.'}}),
            ],
        },
        XCA: {
            position: 'soutien_declare', since: '2026-10-26', previous: null, confidence: 'high',
            signals: [
                signal({id: 'sig_0070', date: '2026-10-26', stance: 'for', mark: 'official', name: 'Nom Exemple', role: 'président de la confédération', binds: true, lang: 'en', article: 10, news: 20, media: 14, at: '2026-10-26T15:00:00Z',
                    sentence: 'Example only: the congress of the confederation backs the incumbent.',
                    translations: {fr: 'Exemple seulement : le congrès de la confédération soutient le sortant.'}}),
            ],
        },
    },
    // a candidate declared a few days ago: one rumour, the rest has not spoken
    Q000010: {
        XXA: {
            position: 'soutien_probable', since: '2026-11-07', previous: null, confidence: 'low',
            signals: [
                rumour({id: 'sig_0100', date: '2026-11-07', stance: 'for', mark: 'reported', lang: 'fr', article: 11, news: 1, media: 1, at: '2026-11-07T18:20:00Z',
                    sentence: 'Exemple fictif : la fédération envisagerait de soutenir ce candidat.',
                    translations: {en: 'Example only: the federation is said to consider backing this candidate.'}}),
            ],
        },
    },
    // Q000011: its news are still being read, nothing yet
};
