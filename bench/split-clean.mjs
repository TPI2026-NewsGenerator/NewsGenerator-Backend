// Read only: what costs an interest its news. The interests of a rewritten tennis profile as the AI
// split it, with their refusals taken out by hand, with also the words of the reader taken out, compared
// with the real split: the share of the news of 48 h each finds. Nothing is written in the database.
//   node --env-file=.env bench/split-clean.mjs
import process from 'node:process';
import {embed, toVector} from '../services/utils/embedder.js';
import {prisma} from '../config/db.js';

const REAL = [
    'Tennis : le circuit ATP, les Grands Chelems et les jeunes joueurs suisses',
    'Intelligence artificielle : les nouveaux modèles, la recherche et la régulation en Europe',
    'Politique suisse : les votations fédérales et les décisions du Conseil fédéral',
];
const VARIANTS = {
    'as split': [
        'Politique suisse : les décisions du Conseil fédéral et les votations fédérales, tout en ignorant la politique cantonale et les faits divers',
        "Intelligence artificielle : Concernant l'intelligence artificielle, je suis la recherche, les nouveaux modèles et la régulation européenne, mais je refuse les cryptomonnaies et les annonces marketing de produits",
        'Tennis : Je suis attentivement le tennis, notamment les jeunes joueurs suisses, le circuit ATP et les Grands Chelems, sans vouloir lire de choses sur la vie privée des joueurs, les cotes ou les paris sportifs',
    ],
    'refusals out': [
        'Politique suisse : les décisions du Conseil fédéral et les votations fédérales',
        "Intelligence artificielle : Concernant l'intelligence artificielle, je suis la recherche, les nouveaux modèles et la régulation européenne",
        'Tennis : Je suis attentivement le tennis, notamment les jeunes joueurs suisses, le circuit ATP et les Grands Chelems',
    ],
    'refusals and reader out': [
        'Politique suisse : les décisions du Conseil fédéral et les votations fédérales',
        "Intelligence artificielle : la recherche, les nouveaux modèles et la régulation européenne",
        'Tennis : les jeunes joueurs suisses, le circuit ATP et les Grands Chelems',
    ],
};

const PER_INTEREST = 40;
const closest = async (vector) => new Set((await prisma.$queryRawUnsafe(`
    SELECT id FROM articles WHERE embedded_at IS NOT NULL AND created_at > now() - interval '48 hours'
    ORDER BY text_dense <#> $1::halfvec LIMIT ${PER_INTEREST}`, toVector(vector.dense))).map(row => Number(row.id)));

const realSets = await Promise.all((await embed(REAL)).map(closest));
const all = new Set(realSets.flatMap(set => [...set]));
for (const [name, texts] of Object.entries(VARIANTS)) {
    const sets = await Promise.all((await embed(texts)).map(closest));
    const union = new Set(sets.flatMap(set => [...set]));
    // each real interest against the variant of the same subject (politics, AI, tennis are in another order)
    const per = [2, 1, 0].map((v, r) => [...realSets[r]].filter(id => sets[v].has(id)).length / realSets[r].size);
    console.log(`${name}: news found ${([...all].filter(id => union.has(id)).length / all.size * 100).toFixed(0)}%, tennis ${(per[0] * 100).toFixed(0)}% AI ${(per[1] * 100).toFixed(0)}% politics ${(per[2] * 100).toFixed(0)}%`);
}
process.exit(0);
