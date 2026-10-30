// Which embedders of EMBEDDER_URL answer, by their place in the list (no address printed). Reads only
import process from 'node:process';

const urls = (process.env.EMBEDDER_URL ?? '').split(',').map(url => url.trim()).filter(Boolean);
for (const [i, url] of urls.entries()) {
    const local = /\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
    try {
        const res = await fetch(`${url.replace(/\/+$/, '')}/health`, {signal: AbortSignal.timeout(3000)});
        console.log(`#${i + 1}${local ? ' (this machine)' : ''}: ${res.status} ${JSON.stringify(await res.json().catch(() => null))}`);
    } catch (err) {
        console.log(`#${i + 1}${local ? ' (this machine)' : ''}: down (${err.cause?.code ?? err.message})`);
    }
}
