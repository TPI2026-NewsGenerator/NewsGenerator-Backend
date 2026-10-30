// A demo of the way of a news through NewsGenerator, without the database: a profile written in the
// page is split into interests by the AI (as the profile page does), and news pasted in the page (their
// addresses or their text) go through what a briefing does with them: read, embedded by bge-m3 (dense
// and sparse), grouped into stories, scored against the interests, chosen by the AI, their key
// passages picked and translated, and read again against what the reader refuses. Every step is sent
// to the page as it ends, with what it took into account. Nothing is saved.
//   node --env-file=.env bench/demo/demo-server.mjs        then http://localhost:4000
// It needs the AI (OLLAMA_API_KEY, internet) and an embedder: the ones of EMBEDDER_URL, then the one of
// this machine (python embedder/server.py, on 127.0.0.1:8020), always asked last.
import http from 'node:http';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

const LOCAL_EMBEDDER = 'http://127.0.0.1:8020';
if (!(process.env.EMBEDDER_URL ?? '').includes(LOCAL_EMBEDDER)) {
    process.env.EMBEDDER_URL = [process.env.EMBEDDER_URL, LOCAL_EMBEDDER].filter(Boolean).join(',');
}

const {embed} = await import('../../services/utils/embedder.js');
const {interestsOf, selectionPrompt, normalizeSelection, balanceSelection, reviewPrompt, normalizeReview, MAX_BRIEFING} = await import('../../services/utils/profile-ai.js');
const {ollamaJson, newUsage} = await import('../../services/utils/ollama.js');
const {extractArticle, passagesText, canSummarize, translateTexts} = await import('../../services/utils/extract.js');
const {languageOf, writtenIn, languageName} = await import('../../services/utils/language.js');
const {blocksOf} = await import('../../services/utils/crawlers.js');
const {Readability} = await import('@mozilla/readability');
const {parseHTML} = await import('linkedom');
const {hostOf, mediumOf} = await import('../../services/utils/public-url.js');
const {readableCards} = await import('../../services/utils/readable-cards.js');
const {default: Links} = await import('../../services/utils/links.js');

const PORT = Number(process.env.DEMO_PORT) || 4000;
const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'demo.html');

// the numbers of the briefing and of the ingestion (services/briefing-service.js, ingest-service.js)
const SPARSE_WEIGHT = 0.5;              // of the sparse score, ranking
const RICH_DESCRIPTION_CHARS = 400;     // the start of the description embedded with the title
const CHOICE_DESCRIPTION_CHARS = 200;   // the start of the description the AI reads to choose
const STORY_THRESHOLD = 0.70;           // dense + sparse of the titles, to join a story
const STORY_TEXT_THRESHOLD = 0.60;      // dense of the texts, to join a story of other media
const STORY_SAME_MEDIUM_MARGIN = 0.5;   // what two titles of one medium need more
const MAX_NEWS = 30;
// the score of the 150th story ranked for a reader of 3 interests on 48 hours, 7 October 2026: a mark,
// not a rule (a briefing gives the AI its 40 best stories of tens of thousands)
const REFERENCE_SCORE = 0.555;

// the words of the vocabulary of bge-m3, to show the sparse vectors with words: its tokenizer, in the
// cache of the model on this machine. Token ids only when it is not there
let vocabulary = null;
const loadVocabulary = () => {
    if (vocabulary !== null) return vocabulary;
    vocabulary = [];
    const hub = process.env.HF_HOME ? join(process.env.HF_HOME, 'hub') : join(homedir(), '.cache', 'huggingface', 'hub');
    const snapshots = join(hub, 'models--BAAI--bge-m3', 'snapshots');
    try {
        for (const snapshot of readdirSync(snapshots)) {
            const path = join(snapshots, snapshot, 'tokenizer.json');
            if (!existsSync(path)) continue;
            const vocab = JSON.parse(readFileSync(path, 'utf8')).model?.vocab;
            if (Array.isArray(vocab) && vocab.length > 250000) {
                vocabulary = vocab.map(entry => entry[0]);
                break;
            }
        }
    } catch { /* no cache: ids are shown */ }
    return vocabulary;
};
const word = (id) => loadVocabulary()[Number(id)] ?? `#${id}`;

const dot = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
};
const sparseDot = (a, b) => {
    let sum = 0;
    for (const id in a) if (id in b) sum += a[id] * b[id];
    return sum;
};
// the words that weigh the most in a sparse vector: [{word, weight}]
const topWords = (sparse, count = 12) => Object.entries(sparse).sort((a, b) => b[1] - a[1]).slice(0, count)
    .map(([id, weight]) => ({word: word(id), weight: round(weight)}));
// the words two sparse vectors share, by what they add to the score
const sharedWords = (a, b, count = 10) => Object.keys(a).filter(id => id in b)
    .map(id => ({word: word(id), news: round(a[id]), interest: round(b[id]), product: a[id] * b[id]}))
    .sort((x, y) => y.product - x.product).slice(0, count).map(shared => ({...shared, product: round(shared.product)}));
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, RICH_DESCRIPTION_CHARS);
    return text ? `${title}. ${text}` : title;
};
const clean = (text) => (text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// A page read as the briefing reads it (Crawlers.Html: Readability, then its blocks), without Crawlee:
// on Windows it waited 30 to 110 s before its first request (its checks of the system), a plain fetch
// answers in a second. null when the page can't be read (refused, no article in it)
const PAGE_TIMEOUT_MS = 20000;
const readPage = async (url) => {
    try {
        const res = await fetch(url, {
            headers: {'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)', 'Accept': 'text/html,application/xhtml+xml'},
            signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
            redirect: 'follow',
        });
        if (!res.ok) return {error: `HTTP ${res.status}`};
        const {document} = parseHTML(await res.text());
        const article = new Readability(document).parse();
        if (!article) return {error: 'aucun article dans la page'};
        return {
            title: article.title ?? '', description: article.excerpt ?? '',
            content: article.textContent?.trim() || '', blocks: blocksOf(article.content),
        };
    } catch (err) {
        return {error: err.name === 'TimeoutError' ? 'trop lente' : err.message};
    }
};

// the profiles generated, by id, as long as this process runs
const profiles = new Map();
let nextProfile = 1;

// POST /api/profile {text, language}: the interests of the profile, as the profile page saves them
const makeProfile = async ({text, language = 'fr'}) => {
    const written = String(text ?? '').trim();
    if (written.length < 20) throw Object.assign(new Error('Écris un profil d’au moins quelques mots.'), {status: 400});
    const started = Date.now();
    const {interests, refused} = await interestsOf({text: written, language, categories: Links.categories()});
    if (interests.length === 0) throw Object.assign(new Error('L’IA n’a trouvé aucun intérêt dans ce profil.'), {status: 502});
    const aiSeconds = (Date.now() - started) / 1000;
    const embedStarted = Date.now();
    const vectors = await embed(interests.map(interest => interest.text));
    const id = String(nextProfile++);
    const profile = {
        id, text: written, language, refused,
        interests: interests.map((interest, i) => ({...interest, id: i + 1, dense: vectors[i].dense, sparse: vectors[i].sparse})),
    };
    profiles.set(id, profile);
    return {
        id, language, refused,
        interests: profile.interests.map(({dense, sparse, ...interest}) => ({
            ...interest,
            words: topWords(sparse, 14),
            weightedWords: Object.keys(sparse).length,
        })),
        seconds: {ai: aiSeconds, embedding: (Date.now() - embedStarted) / 1000},
    };
};

// the news pasted: an address alone on its line, or a text (its first line is its title). Entries are
// separated by a line of three dashes or more; addresses may also follow each other one per line
const parseNews = (input) => String(input ?? '').split(/^\s*-{3,}\s*$/m).flatMap(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    if (lines.every(line => /^https?:\/\/\S+$/i.test(line))) return lines.map(url => ({url}));
    const [title, ...rest] = lines;
    return [{title: title.replace(/^#+\s*/, ''), text: rest.join('\n')}];
}).slice(0, MAX_NEWS);

// POST /api/news {profileId, news}: every step of the briefing, sent as it ends (one JSON a line)
const runNews = async ({profileId, news: input}, send) => {
    const profile = profiles.get(String(profileId));
    if (!profile) throw Object.assign(new Error('Génère d’abord le profil.'), {status: 400});
    const entries = parseNews(input);
    if (entries.length === 0) throw Object.assign(new Error('Colle au moins une adresse ou un texte.'), {status: 400});
    const language = profile.language;
    const usage = {choosing: newUsage(), summarizing: newUsage(), reviewing: newUsage()};
    const seconds = {};
    let started = Date.now();
    const lap = (name) => {
        seconds[name] = (Date.now() - started) / 1000;
        started = Date.now();
    };

    // 1. read: the pages of the addresses, the texts as they are
    const pages = await Promise.all(entries.map(entry => entry.url ? readPage(entry.url) : null));
    const news = entries.map((entry, i) => {
        if (entry.url) {
            const page = pages[i]?.error ? null : pages[i];
            const host = hostOf(entry.url) ?? entry.url;
            return {
                n: i + 1, kind: 'url', url: entry.url, medium: mediumOf(host), source: host,
                title: clean(page?.title) || entry.url,
                description: clean(page?.description),
                page: page && {content: page.content, blocks: page.blocks},
                words: page ? page.content.split(/\s+/).filter(Boolean).length : 0,
                read: Boolean(page),
                error: pages[i]?.error ?? null,
            };
        }
        const content = entry.text;
        return {
            n: i + 1, kind: 'text', url: null, medium: `texte ${i + 1}`, source: 'texte collé',
            title: entry.title, description: clean(content).slice(0, 600),
            page: {content, blocks: []},
            words: content.split(/\s+/).filter(Boolean).length,
            read: true,
        };
    });
    for (const item of news) {
        item.language = languageOf(`${item.title} ${item.description}`) ?? languageOf(item.page?.content ?? '') ?? 'en';
        item.readable = item.read && canSummarize(item.page?.content);
    }
    lap('lecture');
    send({step: 'read', news: news.map(({page, ...item}) => ({...item, languageName: languageName(item.language, 'fr')}))});

    // the ones with a title are embedded: a page that could not be read has only its address
    const embedded = news.filter(item => item.read && item.title);
    if (embedded.length === 0) throw Object.assign(new Error('Aucune nouvelle n’a pu être lue.'), {status: 422});

    // 2. bge-m3: the title alone, and the title with the start of its description
    const texts = embedded.flatMap(item => [item.title, richText(item.title, item.description)]);
    const vectors = await embed(texts);
    embedded.forEach((item, i) => {
        item.titleVector = vectors[2 * i];
        item.textVector = vectors[2 * i + 1];
    });
    lap('vecteurs');
    send({step: 'embed', vocabulary: loadVocabulary().length > 0, news: embedded.map(item => ({
        n: item.n, embeddedText: richText(item.title, item.description),
        dense: Array.from(item.textVector.dense.slice(0, 12), value => round(value, 4)),
        weightedWords: Object.keys(item.textVector.sparse).length,
        words: topWords(item.textVector.sparse, 12),
    }))});

    // 3. stories, as assign_stories groups the news (db/add_briefing.sql): the same language, the titles
    // close (dense + sparse), the texts close too; the titles of one medium need more
    const pairs = [];
    for (let a = 0; a < embedded.length; a++) {
        for (let b = a + 1; b < embedded.length; b++) {
            const [x, y] = [embedded[a], embedded[b]];
            const titleDense = dot(x.titleVector.dense, y.titleVector.dense);
            const titleSparse = sparseDot(x.titleVector.sparse, y.titleVector.sparse);
            const text = dot(x.textVector.dense, y.textVector.dense);
            const sameMedium = x.medium === y.medium;
            const sameLanguage = x.language === y.language;
            const needed = STORY_THRESHOLD + (sameMedium ? STORY_SAME_MEDIUM_MARGIN : 0);
            const joined = sameLanguage && titleDense + titleSparse >= needed && (sameMedium || text >= STORY_TEXT_THRESHOLD);
            pairs.push({a: x.n, b: y.n, titleDense: round(titleDense), titleSparse: round(titleSparse), title: round(titleDense + titleSparse),
                text: round(text), needed, sameMedium, sameLanguage, joined});
        }
    }
    // a news joins the story it resembles: the pairs over the thresholds, in groups
    const groupOf = new Map(embedded.map(item => [item.n, item.n]));
    const root = (n) => groupOf.get(n) === n ? n : root(groupOf.get(n));
    for (const pair of pairs.filter(pair => pair.joined)) groupOf.set(root(pair.b), root(pair.a));
    const stories = [...new Set(embedded.map(item => root(item.n)))].map(first => ({
        id: String(first),
        members: embedded.filter(item => root(item.n) === first),
    }));
    lap('regroupement');
    send({step: 'group', thresholds: {title: STORY_THRESHOLD, text: STORY_TEXT_THRESHOLD, sameMedium: STORY_SAME_MEDIUM_MARGIN},
        pairs: pairs.sort((p, q) => q.title - p.title).slice(0, 40),
        stories: stories.map(story => ({id: story.id, members: story.members.map(item => item.n)}))});

    // 4. ranking, as rank_stories: a news scores its best interest, weight * (dense + 0.5 * sparse) of its
    // text; a story scores its best news
    for (const item of embedded) {
        item.scores = profile.interests.map(interest => {
            const dense = dot(item.textVector.dense, interest.dense);
            const sparse = sparseDot(item.textVector.sparse, interest.sparse);
            return {interest: interest.id, dense: round(dense), sparse: round(sparse), score: round(interest.weight * (dense + SPARSE_WEIGHT * sparse))};
        });
        item.best = item.scores.reduce((best, score) => score.score > best.score ? score : best);
    }
    for (const story of stories) {
        story.lead = story.members.reduce((best, item) => item.best.score > best.best.score ? item : best);
        story.score = story.lead.best.score;
        story.interestId = story.lead.best.interest;
    }
    stories.sort((a, b) => b.score - a.score);
    lap('classement');
    send({step: 'rank', reference: REFERENCE_SCORE, sparseWeight: SPARSE_WEIGHT, stories: stories.map((story, rank) => ({
        id: story.id, rank: rank + 1, lead: story.lead.n, score: story.score, interest: story.interestId,
        members: story.members.map(item => item.n),
        scores: story.lead.scores,
        shared: sharedWords(story.lead.textVector.sparse, profile.interests.find(i => i.id === story.interestId).sparse),
    }))});

    // 5. the AI chooses, against the whole profile: the stories given as a briefing gives them
    const interestTexts = profile.interests.map(interest => interest.text);
    const candidates = stories.map(story => ({
        id: story.id,
        title: story.lead.title,
        description: (story.lead.description ?? '').slice(0, CHOICE_DESCRIPTION_CHARS),
        others: story.members.filter(item => item !== story.lead).map(item => item.title).slice(0, 3),
        trusted: false,
        media: new Set(story.members.map(item => item.medium)).size,
    }));
    const prompt = selectionPrompt(profile.text, candidates, undefined, interestTexts, false);
    const chosen = normalizeSelection(await ollamaJson(prompt, usage.choosing), candidates.map(c => c.id));
    const storyOf = new Map(stories.map(story => [story.id, story]));
    const selected = balanceSelection(chosen, id => storyOf.get(id)?.interestId, profile.interests);
    lap('choix');
    send({step: 'choose', prompt, chosen: chosen.map((item, i) => ({...item, rank: i + 1, inBriefing: selected.includes(item)})),
        notChosen: stories.filter(story => !chosen.some(item => item.id === story.id)).map(story => story.id),
        maxBriefing: MAX_BRIEFING});

    // 6. and 7. the chosen read, their key passages picked and translated, then read again against what
    // the reader refuses; the next chosen take the places of the ones that can't be read or are left out
    const reviews = [];
    const titleTranslation = new Map();
    const read = async (list) => {
        const results = await Promise.all(list.map(async (story) => {
            // the lead first, then a news in the language of the reader, then the others
            const order = [story.lead, ...story.members.filter(item => item !== story.lead)
                .sort((a, b) => (b.language === language) - (a.language === language))];
            const lead = order.find(item => item.readable);
            if (!lead) return {story, unreadable: true, summary: null};
            // the AI failing on a page leaves a card without passages, as in a briefing
            const extract = await extractArticle(lead.title, lead.page, {language, usage: usage.summarizing})
                .catch(() => ({passages: null}));
            if (extract.passages === null) return {story, unreadable: false, lead, summary: {summary: null, translation: null}};
            if (extract.passages.length === 0) return {story, unreadable: true, summary: null};
            return {story, unreadable: false, lead, summary: {
                summary: passagesText(extract.passages), translation: passagesText(extract.translation),
                from: extract.from, topic: extract.topic, sourcing: extract.sourcing,
            }};
        }));
        const readable = results.filter(result => !result.unreadable);
        const foreign = readable.map(result => result.lead)
            .filter(lead => lead.language !== language && writtenIn(lead.language) && writtenIn(language));
        const cards = readable.map(result => ({id: String(result.story.id), title: result.lead.title, summary: result.summary.summary}));
        const reviewText = cards.length > 0 ? reviewPrompt(profile.text, cards, {interests: interestTexts, refused: profile.refused}) : null;
        const [answer, translations] = await Promise.all([
            reviewText ? ollamaJson(reviewText, usage.reviewing).catch(() => null) : null,
            foreign.length > 0 ? translateTexts(foreign.map(lead => ({text: lead.title, from: writtenIn(lead.language)})), writtenIn(language), usage.summarizing) : [],
        ]);
        foreign.forEach((lead, i) => titleTranslation.set(lead, translations[i]));
        const leftOut = normalizeReview(answer, cards.map(card => card.id));
        reviews.push({prompt: reviewText, judged: Array.isArray(answer?.cards) ? answer.cards : [], failed: Boolean(reviewText) && !answer});
        return results.map(result => ({...result, leftOut: leftOut.get(String(result.story.id)) ?? null}));
    };
    const main = selected.map(item => storyOf.get(item.id));
    const reserve = chosen.filter(item => !selected.includes(item)).map(item => storyOf.get(item.id));
    const reasons = new Map(chosen.map(item => [item.id, item.why]));
    const results = [];
    const {cards, unreadable, leftOut} = await readableCards(main, reserve, async (list) => {
        const got = await read(list);
        results.push(...got);
        return got;
    });
    lap('passages et relecture');
    send({step: 'review', reviews, results: results.map(result => ({
        story: result.story.id, lead: result.lead?.n ?? result.story.lead.n, unreadable: result.unreadable,
        leftOut: result.leftOut, fromReserve: reserve.includes(result.story),
    })), unreadable, leftOut});

    // the cards, as the briefing shows them
    send({step: 'cards', cards: cards.map(card => {
        const lead = card.lead;
        return {
            story: card.story.id, title: lead.title, titleTranslation: titleTranslation.get(lead) ?? null,
            language: lead.language, languageName: languageName(lead.language, 'fr'),
            source: lead.source, url: lead.url, why: reasons.get(card.story.id) ?? null,
            interest: profile.interests.find(interest => interest.id === card.story.interestId)?.text ?? null,
            passages: card.summary.summary, translation: card.summary.translation,
            topic: card.summary.topic, sourcing: card.summary.sourcing,
            media: [...new Set(card.story.members.map(item => item.source))],
            fromReserve: reserve.includes(card.story),
        };
    }), usage, seconds});
};

// the embedders asked, in their order, and whether each answers: named by their place, not their address
const status = async () => {
    const urls = process.env.EMBEDDER_URL.split(',').map(url => url.trim()).filter(Boolean);
    const embedders = await Promise.all(urls.map(async (url, i) => {
        try {
            const res = await fetch(`${url.replace(/\/+$/, '')}/health`, {signal: AbortSignal.timeout(2000)});
            const body = res.ok ? await res.json() : null;
            return {name: url === LOCAL_EMBEDDER ? 'ce portable' : `embedder ${i + 1} du réseau`, up: Boolean(body), device: body?.device ?? null};
        } catch {
            return {name: url === LOCAL_EMBEDDER ? 'ce portable' : `embedder ${i + 1} du réseau`, up: false, device: null};
        }
    }));
    return {embedders, ai: Boolean(process.env.OLLAMA_API_KEY || process.env.OLLAMA_HOST), vocabulary: loadVocabulary().length > 0};
};

const body = (req) => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
        data += chunk;
        if (data.length > 2e6) reject(Object.assign(new Error('Trop de texte.'), {status: 413}));
    });
    req.on('end', () => {
        try {
            resolve(JSON.parse(data || '{}'));
        } catch {
            reject(Object.assign(new Error('JSON invalide.'), {status: 400}));
        }
    });
});

const server = http.createServer(async (req, res) => {
    const json = (status, value) => {
        res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(value));
    };
    try {
        if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            return res.end(readFileSync(PAGE));
        }
        if (req.method === 'GET' && req.url === '/api/status') return json(200, await status());
        if (req.method === 'POST' && req.url === '/api/profile') return json(200, await makeProfile(await body(req)));
        if (req.method === 'POST' && req.url === '/api/news') {
            const input = await body(req);
            res.writeHead(200, {'Content-Type': 'application/x-ndjson; charset=utf-8'});
            const send = (event) => res.write(`${JSON.stringify(event)}\n`);
            try {
                await runNews(input, send);
            } catch (err) {
                console.error(err);
                send({step: 'error', message: err.message});
            }
            return res.end();
        }
        json(404, {error: 'Introuvable.'});
    } catch (err) {
        console.error(err);
        json(err.status ?? 500, {error: err.message});
    }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Démo NewsGenerator : http://localhost:${PORT}`));
