// Builds tests/regression/stance-corpus.json: the real cases of the position of an association on a person, with the
// text of each article copied from the news kept (they are purged after 30 days: the corpus must not depend on them) and the
// label chosen by hand, with the reason, so that it can be disputed. Read-only on the database.
// node bench/federations/build-stance-corpus.mjs
import {writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';

const INFANTINO = {name: 'Gianni Infantino'};
const WENGER = {name: 'Arsène Wenger'};
const TASHIMA = {name: 'Kozo Tashima'};
const VEGA = {name: 'Ramon Vega'};
const BECKHAM = {name: 'David Beckham'};

const A = {
    wales: {name: 'Football Association of Wales', country: 'Wales', aliases: ['FAW']},
    france: {name: 'French Football Federation', country: 'France', aliases: ['FFF', 'Fédération française de football']},
    germany: {name: 'German Football Association', country: 'Germany', aliases: ['DFB', 'Deutscher Fußball-Bund']},
    england: {name: 'The Football Association', country: 'England', aliases: ['The FA', 'Football Association']},
    philippines: {name: 'Philippine Football Federation', country: 'Philippines', aliases: ['PFF']},
    mauritania: {name: 'Mauritanian Football Federation', country: 'Mauritania', aliases: ['FFRIM', 'Mauritania FA']},
    southAfrica: {name: 'South African Football Association', country: 'South Africa', aliases: ['SAFA']},
    jordan: {name: 'Jordan Football Association', country: 'Jordan', aliases: ['JFA']},
    australia: {name: 'Football Australia', country: 'Australia', aliases: []},
    denmark: {name: 'Danish Football Association', country: 'Denmark', aliases: ['DBU']},
    norway: {name: 'Norwegian Football Federation', country: 'Norway', aliases: ['NFF']},
    japan: {name: 'Japan Football Association', country: 'Japan', aliases: ['JFA']},
    italy: {name: 'Italian Football Federation', country: 'Italy', aliases: ['FIGC', 'Federcalcio']},
    mexico: {name: 'Mexican Football Federation', country: 'Mexico', aliases: ['FMF']},
    moldova: {name: 'Football Association of Moldova', country: 'Moldova', aliases: ['FMF']},
    scotland: {name: 'Scottish Football Association', country: 'Scotland', aliases: ['Scottish FA', 'SFA']},
    spain: {name: 'Royal Spanish Football Federation', country: 'Spain', aliases: ['RFEF']},
    cameroon: {name: 'Cameroonian Football Federation', country: 'Cameroon', aliases: ['FECAFOOT']},
    nigeria: {name: 'Nigeria Football Federation', country: 'Nigeria', aliases: ['NFF']},
    // matched through the name of a former president (Victor Montagliani, now the head of Concacaf): the way the matching found it
    canada: {name: 'Canadian Soccer Association', country: 'Canada', aliases: ['Canada Soccer', 'Victor Montagliani']},
};

// id, row: the article (id in the news kept on 10.11.2026), the association the matching of names gave it, the person, the label.
// expect: position (null: no position of this association on this person), stance, speaker_kind, explicit, mark (only what the
// case settles); why: the reason of the label; hard: a case a reader could label otherwise, measured apart, not a gate
const SPEC = [
    {id: 'wales-mooney-step-down', row: 91646074, assoc: A.wales, subject: INFANTINO,
        expect: {position: 'non_soutien_declare', stance: 'against', speaker_kind: 'executive', explicit: true, mark: 'official'},
        why: 'The chief executive says the association keeps its view that he should step down: an explicit demand, in the association\'s name.'},
    {id: 'france-refuses-to-back', row: 119525599, assoc: A.france, subject: INFANTINO,
        expect: {position: 'non_soutien_declare', stance: 'against', speaker_kind: 'statement', explicit: true, mark: 'official'},
        why: 'The headline says the federation refuses to back him for a new term: its own decision, plainly. Title only (Google News).'},
    {id: 'france-diallo-jab', row: 64900433, assoc: A.france, subject: INFANTINO,
        expect: {position: 'non_soutien_probable', stance: 'against', speaker_kind: 'president', explicit: false, mark: 'official'},
        why: 'The president criticises him again ("a jab"): his own words and a clear stance, but a criticism, not a refusal to support or a call to go.'},
    {id: 'germany-neuendorf-resign', row: 64403333, assoc: A.germany, subject: INFANTINO,
        expect: {position: 'non_soutien_declare', stance: 'against', speaker_kind: 'president', explicit: true, mark: 'official'},
        why: 'The president and his European colleagues still demand his resignation after his apology: explicit.'},
    {id: 'philippines-supports-reelection', row: 113280392, assoc: A.philippines, subject: INFANTINO,
        expect: {position: 'soutien_declare', stance: 'for', speaker_kind: 'statement', explicit: true, mark: 'official'},
        why: 'The federation\'s own website: "PFF supports ... re-election".'},
    {id: 'mauritania-yahya-backs', row: 64358411, assoc: A.mauritania, subject: INFANTINO,
        expect: {position: 'soutien_declare', stance: 'for', speaker_kind: 'president', explicit: true, mark: 'official'},
        why: 'The president has thrown his support behind him and says he is the right person to lead.'},
    {id: 'southafrica-jordaan-thanks', row: 93951466, assoc: A.southAfrica, subject: INFANTINO,
        expect: {position: 'soutien_probable', stance: 'for', speaker_kind: 'president', explicit: false, mark: 'official'},
        why: 'The president thanks FIFA and says the continent benefited under his leadership: praise, no word on the election.'},
    {id: 'jordan-prince-ali-pure-politics', row: 89567764, assoc: A.jordan, subject: INFANTINO,
        expect: {position: 'non_soutien_probable', stance: 'against', speaker_kind: 'president', explicit: false, mark: 'official'},
        why: 'The chief of the association attacks his re-election bid ("pure politics", delegates silenced at the AFC congress): against, but no plain refusal to vote for him.'},
    {id: 'jordan-askanews-pure-politics', row: 89232623, assoc: A.jordan, subject: INFANTINO,
        expect: {position: 'non_soutien_probable', stance: 'against', speaker_kind: 'president', explicit: false, mark: 'official'},
        why: 'Same event in Italian ("Presidente Jfa"): the president denounces that he used the AFC congress for his re-election. The text is cut before the country.'},
    {id: 'norway-klaveness-critic', row: 57826979, assoc: A.norway, subject: INFANTINO,
        expect: {position: 'non_soutien_probable', stance: 'against', explicit: false},
        why: 'AFP calls the head of the federation a long-time critic: a description by the agency, not her words, so never declared.'},
    {id: 'japan-okada-resigns', row: 93284806, assoc: A.japan, subject: INFANTINO, hard: true,
        expect: {position: 'non_soutien_probable', stance: 'against', speaker_kind: 'deputy', explicit: false, mark: 'official'},
        why: 'The vice-president resigns over the AFC backing him: a protest of an officer, who does not bind the association. But the text says he protests the AFC\'s backing, not what he thinks of Infantino himself. (Moved to hard after the first measure of 10.11.2026.)'},
    {id: 'wenger-france-diallo-supports', row: 96109591, assoc: A.france, subject: WENGER,
        expect: {position: 'soutien_declare', stance: 'for', speaker_kind: 'president', explicit: true, mark: 'official'},
        why: 'Another subject: the headline says the president of the FFF supports Wenger for the presidency of FIFA. Title only.'},
    {id: 'wenger-france-diallo-door', row: 95635989, assoc: A.france, subject: WENGER,
        expect: {position: 'soutien_probable', stance: 'for', speaker_kind: 'president', explicit: false, mark: 'official'},
        why: 'The president "opens the door wide" to a candidacy of Wenger: favourable, not a support.'},

    // the ones the matching of names must not give a position
    {id: 'japan-tashima-announces-vs-infantino', row: 111418436, assoc: A.japan, subject: INFANTINO, hard: true,
        expect: {position: null},
        why: 'The honorary president announces he will stand against Infantino. A rule to settle, not a fact: a former president does not bind the association (probable, as gemma4:31b reads it) or a rival candidate speaks for himself and gives his association nothing (none, as deepseek-v4-pro and gpt-oss:120b read it, and what is recommended). Label none; it was changed to probable and back on 10.11.2026, hence hard.'},
    {id: 'japan-tashima-announces-self', row: 111418436, assoc: A.japan, subject: TASHIMA,
        expect: {position: null},
        why: 'Same article, the person asked about is Tashima: he supports himself, which says nothing of the association.'},
    {id: 'italy-federcalcio-mauritana', row: 67025377, assoc: A.italy, subject: INFANTINO,
        expect: {position: null},
        why: 'Matched through "Federcalcio": it is the federation of Mauritania, not the Italian one.'},
    {id: 'moldova-fmf-is-mexico', row: 86656369, assoc: A.moldova, subject: INFANTINO,
        expect: {position: null},
        why: 'Matched through the initials FMF: it is the Mexican federation (the text says the Mexican team).'},
    {id: 'jordan-jfa-text-for-japan', row: 89232623, assoc: A.japan, subject: INFANTINO, hard: true,
        expect: {position: null},
        why: 'The same text of "Presidente Jfa" given to Japan: the text is cut before the country, only the congress of the AFC tells it is Tokyo. A reader cannot be sure.'},
    {id: 'scotland-vega-asks-support', row: 116244396, assoc: A.scotland, subject: INFANTINO,
        expect: {position: null},
        why: 'A former player urges the Scottish FA to back his bid: a request addressed to it, nothing it said.'},
    {id: 'scotland-vega-asks-support-for-vega', row: 116244396, assoc: A.scotland, subject: VEGA,
        expect: {position: null},
        why: 'Same text, the person asked about is Vega: the association has not answered the request.'},
    {id: 'spain-2030-final', row: 58513250, assoc: A.spain, subject: INFANTINO, hard: true,
        expect: {position: null},
        why: 'The "support" of the text is for a stadium for the 2030 final, not for a person. But it adds that the president of the RFEF has a close relationship with Infantino: a hint, not a stance.'},
    {id: 'cameroon-eto-o-complaint', row: 67261865, assoc: A.cameroon, subject: INFANTINO,
        expect: {position: null},
        why: 'A complaint about the accusations against Eto\'o: nothing on the election.'},
    {id: 'nigeria-nff-is-norway', row: 57826979, assoc: A.nigeria, subject: INFANTINO,
        expect: {position: null},
        why: 'Matched through the initials NFF: it is the Norwegian federation.'},
    {id: 'england-fa-in-wales-text', row: 91646074, assoc: A.england, subject: INFANTINO,
        expect: {position: null},
        why: '"Football Association" is the start of "Football Association of Wales": the text is about Wales.'},
    {id: 'canada-concacaf-president', row: 63984954, assoc: A.canada, subject: INFANTINO,
        expect: {position: null},
        why: 'The president of Concacaf, not of the Canadian association, and about his own re-election.'},

    // cases a reader could label otherwise
    {id: 'england-chair-not-fit', row: 78057902, assoc: A.england, subject: INFANTINO, hard: true,
        expect: {position: 'non_soutien_declare', stance: 'against', speaker_kind: 'president', explicit: true, mark: 'official'},
        why: 'The title quotes the chair ("Not fit to be FIFA president") but the text says she questioned his fitness to lead: explicit or a doubt?'},
    {id: 'australia-isaac-premature', row: 74951310, assoc: A.australia, subject: INFANTINO, hard: true,
        expect: {position: null},
        why: 'The chair appears to back the direction of FIFA but says it is premature to talk about support for him: mixed.'},
    {id: 'denmark-moller-challenger', row: 108210413, assoc: A.denmark, subject: INFANTINO, hard: true,
        expect: {position: 'non_soutien_probable', stance: 'against', explicit: false},
        why: 'The Danish FA repeats that UEFA will find a challenger: an expectation, not its vote.'},
    {id: 'mexico-infantino-boasts', row: 86029394, assoc: A.mexico, subject: INFANTINO, hard: true,
        expect: {position: null},
        why: 'It is Infantino who boasts of the support of the Mexican federation: the claim of the person himself, not its word.'},
    {id: 'beckham-uefa-dfb-weigh', row: 100072268, assoc: A.germany, subject: BECKHAM, hard: true,
        expect: {position: null},
        why: 'UEFA and the DFB "weigh" Beckham as a challenger: a rumour of an idea, not a support.'},
];

const clean = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

// whether a key stands alone in a text (not inside a longer word: "faw" is not in "fawkes")
const names = (text, key) => new RegExp(`(?<![\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(plain(text));

// The passage the AI reads: the sentences of the description that name the association (or its initials) first, then those that
// name the person, in their order; the first one when none does. At most 700 characters: the ones that only name the person go
// first when it is too long (the association is what the matching of names found, the passage must keep it). The title is given apart
const passageOf = (description, subject, association) => {
    const ofPerson = [plain(subject.name).split(' ').at(-1)];
    const ofAssociation = [association.name, ...association.aliases].map(plain).filter(key => key.length >= 3);
    const sentences = clean(description).split(/(?<=[.!?…\]])\s+/u).filter(Boolean);
    const mine = sentences.map(sentence => ofAssociation.some(key => names(sentence, key)));
    const his = sentences.map(sentence => ofPerson.some(key => names(sentence, key)));
    let keep = sentences.map((_, i) => mine[i] || his[i]);
    const length = () => sentences.filter((_, i) => keep[i]).join(' ').length;
    for (let i = sentences.length - 1; i >= 0 && length() > 700; i--) if (keep[i] && !mine[i]) keep[i] = false;
    if (!keep.some(Boolean)) keep = sentences.map((_, i) => i === 0);
    const text = sentences.filter((_, i) => keep[i]).join(' ');
    return text.length <= 700 ? text : `${text.slice(0, 700).replace(/\s+\S*$/, '')} …`;
};

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, link, medium_of(link) AS medium, lang, title, description, COALESCE(published_at, created_at) AS at
    FROM articles WHERE id = ANY($1::int[])`, [...new Set(SPEC.map(item => item.row))]);
const byId = new Map(rows.map(row => [row.id, row]));

const cases = SPEC.map(item => {
    const row = byId.get(item.row);
    if (!row) throw new Error(`${item.id}: article ${item.row} is not in the news kept`);
    return {
        id: `live-stance-${item.id}`,
        family: 'stance',
        origin: `${row.medium}, article #${item.row} of the news kept on 10.11.2026, ${new Date(row.at).toISOString().slice(0, 10)}; label by hand (Claude, to be disputed)`,
        ...(item.hard ? {hard: true} : {}),
        why: item.why,
        input: {
            subject: item.subject,
            association: item.assoc,
            article: {
                title: clean(row.title),
                passage: passageOf(row.description, item.subject, item.assoc),
                medium: row.medium,
                date: new Date(row.at).toISOString().slice(0, 10),
                lang: row.lang,
                url: row.link,
            },
        },
        expect: item.expect,
    };
});

const corpus = {
    about: 'Real cases of the position of a football association on a person, for the API of the positions (services/utils/stance.js): the passage as the AI reads it (title and the sentences of the description that name the person or the association), the association the matching of names gave, and the position it must come to (null: none). "live" holds the gate (every case must hold, regression-run.mjs --corpus=tests/regression/stance-corpus.json), "hard" the cases a reader could label otherwise, measured apart by bench/federations/stance-bench.mjs. The labels were chosen by hand, with the reason in "why": a label that is wrong is corrected here, then the code.',
    live: cases.filter(item => !item.hard),
    hard: cases.filter(item => item.hard),
};
writeFileSync(new URL('../../tests/regression/stance-corpus.json', import.meta.url), JSON.stringify(corpus, null, 1));
console.log(`${corpus.live.length} cases of the gate, ${corpus.hard.length} hard, ${cases.filter(item => item.expect.position !== null).length} with a position, ${cases.filter(item => item.expect.position === null).length} with none`);
for (const item of cases) console.log(`\n${item.id}${item.hard ? ' [hard]' : ''} -> ${item.expect.position}\n  ${item.input.article.lang} ${item.input.article.medium} ${item.input.article.date}\n  T: ${item.input.article.title}\n  P: ${item.input.article.passage || '(none)'}`);
await prisma.$disconnect();
