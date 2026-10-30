const url = 'https://www.dailymail.com/home/rssMenu.html';
const variant = process.argv[2];
const opts = {headers: {'User-Agent': 'x'}, redirect: 'manual'};
if (variant !== 'nosignal') opts.signal = AbortSignal.timeout(8000);
const res = await fetch(new URL(url), opts);
const text = await res.text();
console.log(variant, 'text', text.length);
await new Promise(r => setTimeout(r, 6000));
console.log('done');
