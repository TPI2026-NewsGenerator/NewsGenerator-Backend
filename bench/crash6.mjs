import {Crawlers} from '../services/utils/crawlers.js';
import {guardFetch} from '../services/utils/public-url.js';
guardFetch();
for (let i = 0; i < 4; i++) {
    const t = Date.now();
    const [r] = await Crawlers.Xml([{url: 'https://www.dailymail.com/home/rssMenu.html'}]);
    console.log(i, Date.now() - t, 'ms', r.error ?? `${r.items.length} items`);
}
process.exit(0);
