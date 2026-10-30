// share of the words of a feed's last news that are the short words of its best language
import 'dotenv/config';
import pg from 'pg';
const WORDS = {
    fr: 'le la les des une un du et est dans pour sur au aux avec par pas qui que ce cette son ses sont plus leur',
    en: 'the a an of and is in for on to with by not who that this his her are more from at as its was',
    es: 'el la los las un una del y es en para con por que se su sus al como más pero',
    it: 'il lo la gli le un una del della di e è in per con che si non al come più sono',
    de: 'der die das den dem des ein eine und ist im in für mit von auf nicht sich zu dass wird bei',
    nl: 'het een van op met voor niet zijn dat aan bij ook naar om wordt werd hun deze nog maar uit over',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, new Set(w.split(' '))]));
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`
    SELECT f.url, (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url LIMIT 1) AS declared,
           array_agg(a.title ORDER BY a.id DESC) AS titles
    FROM feeds f JOIN articles a ON a.id_feed = f.id
    WHERE f.url NOT LIKE 'https://news.google.com/%' AND a.created_at > now() - interval '3 days'
    GROUP BY f.url`);
await client.end();
const out = rows.map(row => {
    const words = row.titles.slice(0, 30).join(' ').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    const scores = Object.entries(SETS).map(([l, s]) => [l, words.filter(w => s.has(w)).length / (words.length || 1)]).sort((a, b) => b[1] - a[1]);
    return {url: row.url.slice(8, 60), declared: row.declared, best: scores[0][0], density: +scores[0][1].toFixed(3), second: +scores[1][1].toFixed(3), words: words.length};
}).sort((a, b) => a.density - b.density);
console.table(out.slice(0, 45));
const buckets = [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 1];
console.log(buckets.map(b => `<${b}: ${out.filter(r => r.density < b).length}`).join('  '));
