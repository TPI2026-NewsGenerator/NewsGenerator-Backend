// Read-only: finds in the news kept the articles of the real cases chosen by hand (see build-stance-corpus.mjs), to read
// their title and description before labelling them. node bench/federations/find-cases.mjs
import {prisma} from '../../config/db.js';

// [key, a phrase of the article (regex), the medium it was read on]
const FIND = [
    ['wales', 'retains the view that Fifa president Gianni Infantino should step down', 'bbc.co.uk'],
    ['france-refuses', 'la FFF refuse de soutenir Gianni Infantino', null],
    ['france-diallo', 'Philippe Diallo ha criticato', 'tuttomercatoweb.com'],
    ['germany', 'fordern auch nach einer Entschuldigung', 'sportschau.de'],
    ['england', 'Debbie Hewitt questioned', 'yahoo.com'],
    ['philippines', 'PFF supports FIFA President', 'pff.org.ph'],
    ['mauritania', 'Ahmed Yahya backs Infantino', 'africasoccer.com'],
    ['southafrica', 'Jordaan has thanked FIFA', 'africasoccer.com'],
    ['jordan', 'delegates were silenced', null],
    ['australia', 'premature.{0,6} to talk about support', 'theguardian.com'],
    ['denmark', 'Danish FA \\(DBU\\) has repeated', null],
    ['norway', 'Long-time Infantino critic Lise Klaveness', null],
    ['okada', 'Okada abruptly quits', null],
    ['tashima', 'Tashima, honorary president of the Japan Football Association, said', null],
    ['qds', 'Congresso Afc pura politica', null],
    ['federcalcio-mauritana', 'Federcalcio mauritana esprime', null],
    ['mexico', 'presumió apoyo para su reelección', null],
    ['moldova-fmf', 'presume apoyo durante encuentro con Mikel Arriola', null],
    ['scotland', 'Vega urges the Scottish FA', null],
    ['spain', 'Louzán, presidente de la RFEF, echa un pulso', null],
    ['cameroon', 'Infantino pode ser alvo de denúncia', null],
    ['canada', 'Montagliani, président de la Concacaf', null],
    ['wenger-supports', 'Diallo soutient Wenger', null],
    ['wenger-door', 'ouvre grand la porte à une candidature', null],
    ['beckham', 'UEFA and DFB weigh David Beckham', null],
];

const clean = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
for (const [key, pattern, medium] of FIND) {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT id, link, medium_of(link) AS medium, lang, title, description, COALESCE(published_at, created_at) AS at
        FROM articles WHERE search_text ~* $1 AND COALESCE(published_at, created_at) >= now() - interval '30 days'
        ORDER BY (medium_of(link) = $2::text) DESC, COALESCE(published_at, created_at) ASC LIMIT 3`, pattern, medium ?? '');
    console.log(`\n### ${key}: ${rows.length} found`);
    for (const row of rows.slice(0, 2)) {
        console.log(`  #${row.id} ${row.medium} ${row.lang} ${new Date(row.at).toISOString().slice(0, 10)}\n    T: ${row.title}\n    D: ${clean(row.description).slice(0, 380)}`);
    }
}
await prisma.$disconnect();
