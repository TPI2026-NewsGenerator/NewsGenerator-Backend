// dry: the names searched as plain texts (ILIKE, which the trigram index answers), with and without
// their accents, then checked as whole words in node. Reads only
import {prisma} from '../config/db.js';
import {Filter} from '../services/utils/filter.js';
import {feedsOf} from '../services/briefing-service.js';

const names = ['Paris Saint-Germain', 'PSG', 'Parc des Princes', 'Ousmane Dembélé', 'Luis Enrique', 'Fabián Ruiz', 'Nuno Mendes',
    'Ferran Torres', 'Désiré Doué', 'Maghnes Akliouche', 'Senny Mayulu', 'Lucas Beraldo', 'Achraf Hakimi', 'Willian Pacho',
    'João Neves', 'Vitinha', 'Warren Zaïre-Emery', 'Lucas Chevalier', 'Illya Zabarnyi', 'Khvicha Kvaratskhelia',
    'Nasser Al-Khelaïfi', 'Ligue 1', 'Lucas Hernandez', 'Gonçalo Ramos', 'Bradley Barcola', 'Marquinhos', 'Lee Kang-in',
    'Matvey Safonov', 'Kang-in Lee', 'Qatar Sports Investments', 'Edouard Michut', 'Cher Ndour', 'Ethan Mbappé', 'Djeidi Gassama',
    'Gabriel Moscardo', 'Lucas Lavallée', 'Yoram Zague', 'Vítor Ferreira', 'Naoufel El Hannach', 'Renato Marin', 'Dro Fernández',
    'Lucas Digne', 'Mika Godts', 'PSGFC', 'Paris St. Germain'];
const feedUrls = await feedsOf(8);
const hours = Number(process.argv[2] ?? 48);
const since = new Date(Date.now() - hours * 3600e3);
const like = (text) => `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
const texts = [...new Set(names.flatMap(name => [name, Filter.withoutAccents(name)]))];

const started = Date.now();
const rows = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.title, a.description, a.id_story
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz
      AND (${texts.map((_, i) => `a.search_text ILIKE $${i + 3}`).join(' OR ')})`,
    feedUrls, since, ...texts.map(like));
const fetched = Date.now() - started;
const matches = Filter.matcher(Filter.parse([names.map(name => `"${name}"`).join(', ')]));
const kept = rows.filter(row => matches(`${row.title} ${row.description ?? ''}`));
console.log(`${hours} h: ${rows.length} candidates in ${(fetched / 1000).toFixed(1)} s, ${kept.length} naming one (watchedNews found 708 in 48 h), ${((Date.now() - started) / 1000).toFixed(1)} s in all`);
await prisma.$disconnect();
process.exit(0);
