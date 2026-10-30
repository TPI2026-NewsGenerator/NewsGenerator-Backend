// our search against Google News, the same sentences over 7 days
// node --env-file=.env bench/vs-google.mjs <userId> [label]   -> bench/data/vs-google/<date>[-label].json
import fs from 'node:fs';
import pg from 'pg';
import {NewsService} from '../services/news-service.js';

const QUERIES = [
    // followed by a profile (their Google News searches are in the pool)
    {language: 'fr', text: "l'arbitrage vidéo en Ligue 1", followed: true},
    {language: 'fr', text: 'les nouveaux modèles de voitures électriques', followed: true},
    {language: 'fr', text: 'les cartes Pokémon', followed: true},
    {language: 'en', text: 'the Artemis II astronauts of NASA', followed: true},
    {language: 'en', text: 'Premier League referee decisions', followed: true},
    {language: 'en', text: "the America's Cup sailing race", followed: true},
    // followed by nobody
    {language: 'fr', text: "le budget de l'État et la réforme des retraites en France", followed: false},
    {language: 'fr', text: "les prix de l'immobilier en Suisse", followed: false},
    {language: 'fr', text: 'les vendanges en Valais', followed: false},
    {language: 'fr', text: 'les incendies de forêt', followed: false},
    {language: 'en', text: 'the interest rate decision of the Federal Reserve', followed: false},
    {language: 'en', text: 'measles outbreaks', followed: false},
    {language: 'en', text: 'the Swiss chocolate industry', followed: false},
    {language: 'en', text: 'new AI models for programming', followed: false},
    {language: 'en', text: 'Taylor Swift', followed: false},
];
const LOCALES = {en: 'hl=en-US&gl=US&ceid=US:en', fr: 'hl=fr&gl=FR&ceid=FR:fr'};
const CATEGORIES = ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'];
const DAYS = 7;
const GOOGLE_TOP = 30;

const userId = Number(process.argv[2]);
const label = process.argv[3] ? `-${process.argv[3]}` : '';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();

// the media our feeds bring (Google News rows left out), and the medium of a site as the DB writes it
const known = new Set((await c.query(`SELECT DISTINCT a.medium FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url NOT LIKE 'https://news.google.com/%' AND a.created_at > now() - interval '30 days' AND a.medium IS NOT NULL`)).rows.map(r => r.medium));
const mediumOf = async (site) => (await c.query('SELECT medium_of($1) AS m', [`https://${site}/`])).rows[0].m;

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const google = async ({language, text}) => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${text} when:${DAYS}d`)}&${LOCALES[language]}`;
    const res = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0'}});
    if (!res.ok) throw new Error(`Google ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
        const name = decode(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '');
        const site = new URL(item.match(/<source url="([^"]+)"/)?.[1] ?? 'https://unknown').hostname.replace(/^www\./, '');
        let title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
        if (title.endsWith(` - ${name}`)) title = title.slice(0, -name.length - 3);
        return {title, site, name, date: item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]};
    });
    return {total: items.length, top: items.slice(0, GOOGLE_TOP)};
};

const out = [];
for (const query of QUERIES) {
    const started = Date.now();
    const ours = await NewsService.getNews({keywords: [query.text], category: CATEGORIES, userId, language: query.language,
        timeframe: {start: new Date(Date.now() - DAYS * 864e5).toISOString()}});
    const seconds = (Date.now() - started) / 1000;
    const g = await google(query);
    for (const item of g.top) {
        item.medium = await mediumOf(item.site);
        item.known = known.has(item.medium);
    }
    out.push({...query, seconds, web: ours.web === true, ours: ours.news.map(n => ({match: n.match, title: n.title, source: n.source, media: n.corroboration?.media ?? null})),
        googleTotal: g.total, google: g.top});
    console.log(`${query.language} ${query.text}: ours ${ours.news.length}${ours.web ? ' (with Google)' : ''} (${ours.news.filter(n => n.match === 'answer').length} answers) in ${seconds.toFixed(0)} s, Google ${g.total}, top ${GOOGLE_TOP} from media we read: ${g.top.filter(i => i.known).length}`);
    await new Promise(r => setTimeout(r, 4000));
}
await new Promise(r => setTimeout(r, 20000));   // the news Google gives a search answering enough are read after it
fs.mkdirSync("bench/data/vs-google", {recursive: true});
const file = `bench/data/vs-google/${new Date().toISOString().slice(0, 10)}${label}.json`;
fs.writeFileSync(file, JSON.stringify({known: known.size, queries: out}, null, 1));
console.log(`known media ${known.size} -> ${file}`);
await c.end();
process.exit(0);
