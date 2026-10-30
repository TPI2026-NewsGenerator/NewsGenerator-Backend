import {fetchPublicUrl} from '../services/utils/public-url.js';
import {Parser} from '../services/utils/parser.js';
const url = 'https://www.dailymail.com/home/rssMenu.html';
const t = Date.now();
const {res} = await fetchPublicUrl(url, {headers: {'User-Agent': 'x'}, timeoutMs: 8000});
const text = await res.text();
console.log('text', Date.now() - t, text.length);
if (process.argv[2] === 'parse') {
  const items = await Parser.Xml(text);
  console.log('parsed', Date.now() - t, items.length);
}
await new Promise(r => setTimeout(r, 8000));
console.log('done');
process.exit(0);
