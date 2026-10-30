// how fast Wikidata lets the searches go: one every PAUSE ms until a 429
const PAUSE = Number(process.argv[2] ?? 1000);
const names = ['Lettonie', 'Donald Trump', 'Apple', 'Ligue 1', 'Aleksander Čeferin', 'Vadims Ļašenko', 'Latvia', 'FIFA', 'Kylian Mbappé', 'Real Madrid',
    'Emmanuel Macron', 'Bundesliga', 'Olympique de Marseille', 'Lionel Messi', 'NATO', 'Volodymyr Zelensky', 'Tesla', 'Elon Musk', 'Arsenal', 'Chelsea',
    'Liverpool', 'Pep Guardiola', 'Mikel Arteta', 'Serie A', 'Juventus', 'Inter Milan', 'AC Milan', 'Napoli', 'Roma', 'Lazio'];
const t = Date.now();
for (const [i, name] of names.entries()) {
    const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=10&format=json`,
        {headers: {'User-Agent': 'NewsGenerator/1.0 (self-hosted news reader)'}});
    if (!res.ok) { console.log(`${i} ok then ${res.status} after ${Date.now() - t} ms, retry-after ${res.headers.get('retry-after')}`); process.exit(); }
    await new Promise(r => setTimeout(r, PAUSE));
}
console.log(`${names.length} ok in ${Date.now() - t} ms`);
