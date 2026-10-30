// One text translated by translateTexts, to see why a card keeps its original
//   node --env-file=.env bench/translate-one.mjs "text" [from] [to]
import {translateTexts} from '../services/utils/extract.js';
import {newUsage} from '../services/utils/ollama.js';

const [text, from = 'English', to = 'French'] = process.argv.slice(2);
for (let i = 0; i < 3; i++) {
    const usage = newUsage();
    const started = Date.now();
    const [translation] = await translateTexts([{text, from}], to, usage);
    console.log(`${Date.now() - started} ms`, JSON.stringify(usage), translation);
}
process.exit(0);
