import {NewsService} from '../services/news-service.js';
const day = 864e5;
const all = ['world','press','sport','politics','economy','technology','science'];
for (const [q, language, category, days] of [['cartes tcg suisse', 'fr', ['world'], 30], ['cartes tcg suisse', 'fr', all, 30], ['cartes Pokémon', 'fr', all, 30], ['cartes Pokémon', 'fr', ['sport'], 30], ['"Pokémon"', 'fr', all, 30], ['arbitrage vidéo en Ligue 1', 'fr', ['sport'], 7]]) {
    const t = Date.now();
    const r = await NewsService.getNews({keywords: [q], category, language, userId: 4, timeframe: {start: new Date(Date.now() - days * day).toISOString()}});
    const answers = r.news.filter(n => n.match !== 'related');
    console.log(`\n${q} | ${language} ${category.length > 1 ? 'all' : category[0]} ${days}d: ${answers.length} answers, ${r.totalResults} cards (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    for (const n of answers.slice(0, 5)) console.log(`  ${n.source ?? ''} | ${n.title?.slice(0, 100)}`);
}
process.exit(0);
