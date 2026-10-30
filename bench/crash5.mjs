process.on('uncaughtException', (err) => {
    if (err?.code === 'ERR_ASSERTION' && /onHttpSocketEnd/.test(err.stack ?? '')) { console.log('guarded'); return; }
    throw err;
});
for (let i = 0; i < 4; i++) {
    const t = Date.now();
    try {
        const res = await fetch('https://www.dailymail.com/home/rssMenu.html', {headers: {'User-Agent': 'x'}, signal: AbortSignal.timeout(8000)});
        const text = await res.text();
        console.log(i, 'text', text.length, Date.now() - t);
    } catch (e) { console.log(i, 'rejected', e.name, Date.now() - t); }
}
