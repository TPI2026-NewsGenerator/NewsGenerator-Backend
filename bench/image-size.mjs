// The width and height of an image of the web read from its first bytes (JPEG, PNG, GIF, WebP), the
// rest never downloaded. {width, height, type, bytes} or {error}
const TIMEOUT = 8000;
const MAX_READ = 512 * 1024;

const jpeg = (b) => {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const length = b.readUInt16BE(i + 2);
        // the frames that tell the size: SOF0-15 but DHT (c4), JPG (c8), DAC (cc)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return {height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7)};
        }
        i += 2 + length;
    }
    return null;
};
const webp = (b) => {
    const kind = b.subarray(12, 16).toString('latin1');
    if (kind === 'VP8 ') return {width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff};
    if (kind === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return {width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1};
    }
    if (kind === 'VP8X') return {width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3)};
    return null;
};
const sizeOf = (b) => {
    if (b[0] === 0xff && b[1] === 0xd8) return {type: 'jpeg', ...jpeg(b)};
    if (b.subarray(1, 4).toString('latin1') === 'PNG') return {type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20)};
    if (b.subarray(0, 4).toString('latin1') === 'GIF8') return {type: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8)};
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return {type: 'webp', ...webp(b)};
    return {type: 'other'};
};

export const imageSize = async (url) => {
    try {
        const res = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT), headers: {'User-Agent': 'Mozilla/5.0', Accept: 'image/avif,image/webp,image/*'}});
        if (!res.ok) return {error: `http ${res.status}`};
        const reader = res.body.getReader();
        const chunks = [];
        let read = 0;
        let size = null;
        while (read < MAX_READ) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            read += value.length;
            size = sizeOf(Buffer.concat(chunks));
            if (size.width) break;
        }
        reader.cancel().catch(() => {});
        return size?.width ? {...size, bytes: Number(res.headers.get('content-length')) || undefined} : {error: size?.type ?? 'empty'};
    } catch (error) {
        return {error: error.name === 'TimeoutError' ? 'timeout' : error.cause?.code ?? error.message};
    }
};
