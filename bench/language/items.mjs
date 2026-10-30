import {Crawlers} from '../../services/utils/crawlers.js';
import {languageOf} from '../../services/utils/language.js';
const [feed] = await Crawlers.Xml([{url: process.argv[2]}]);
for (const item of feed.items.slice(0, 12)) console.log(languageOf(`${item.title ?? ''} ${item.description ?? ''}`), '|', (item.title ?? '').slice(0, 60), '|', (item.description ?? '').slice(0, 80).replace(/\s+/g, ' '));
