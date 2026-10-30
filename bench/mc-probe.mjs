import process from 'node:process';
const H = {Authorization: `Token ${process.env.MEDIACLOUD_API_TOKEN}`, Accept: 'application/json'};
const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const cs = '34412146,38379799,34411591,38380954,34412298';
const variants = {
    and: '(Super AND League AND Suisse) AND language:fr',
    title: '(title:Super AND title:League AND title:Suisse) AND language:fr',
    andTcg: '(TCG AND actualit?s) AND language:fr',
};
for (const [name, q] of Object.entries(variants)) {
    const res = await fetch(`https://search.mediacloud.org/api/search/sources?${new URLSearchParams({q, start, end, platform: 'onlinenews-mediacloud', cs})}`, {headers: H});
    const body = await res.json().catch(() => ({}));
    console.log(name, res.status, (body.sources ?? []).slice(0, 14).map(s => `${s.source}(${s.count})`).join(' '), body.note ?? '');
    await new Promise(r => setTimeout(r, 31000));
}
