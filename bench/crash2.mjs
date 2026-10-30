import {Crawlers} from '../services/utils/crawlers.js';
const t = Date.now();
const r = await Crawlers.Xml([{url: 'https://www.dailymail.com/home/rssMenu.html'}]);
console.log(Date.now() - t, r[0].error, r[0].items?.length);
process.exit(0);
