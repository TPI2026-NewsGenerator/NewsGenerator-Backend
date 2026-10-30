// How long "Look on the web" takes: findFeeds on a few sites, with the judge by words and by meaning,
// the texts sent to the embedder counted
// node --env-file=.env bench/time-suggest.mjs "<query>" <language> <site> [<site>...]
import 'dotenv/config';
import {findFeeds} from '../services/utils/feed-finder.js';
import {embed} from '../services/utils/embedder.js';
import {judgeOf} from '../services/utils/meaning-judge.js';

const [query, language, ...sites] = process.argv.slice(2);
const seconds = (from) => ((Date.now() - from) / 1000).toFixed(1);

const [vector] = await embed([query]);
for (const site of sites) {
    let t = Date.now();
    const byWords = (await findFeeds(site, {language, subject: [query]}))[0];
    console.log(`${site} by words: ${seconds(t)}s ${byWords?.url} ${byWords?.onSubject}/${byWords?.judged}`);

    const inner = judgeOf([vector.dense]);
    let calls = 0, texts = 0, judgeMs = 0;
    const judge = async (list) => {
        const s = Date.now();
        calls++;
        texts += list.length;
        try {
            return await inner(list);
        } finally {
            judgeMs += Date.now() - s;
        }
    };
    t = Date.now();
    const byMeaning = (await findFeeds(site, {language, subject: [query], judge}))[0];
    console.log(`${site} by meaning: ${seconds(t)}s (judge ${calls} calls, ${texts} texts, ${(judgeMs / 1000).toFixed(1)}s summed) ${byMeaning?.url} ${byMeaning?.onSubject}/${byMeaning?.judged}`);
}
process.exit(0);
