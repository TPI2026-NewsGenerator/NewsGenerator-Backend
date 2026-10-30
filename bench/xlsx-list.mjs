// the addresses of a list as the client reads them (client/src/features/briefing/importFile.js), one per line
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../client/package.json', import.meta.url));
globalThis.DOMParser = new (require('jsdom').JSDOM)().window.DOMParser;
const {addressesOfXlsx} = await import('../../client/src/features/briefing/importFile.js');
console.log(addressesOfXlsx(new Uint8Array(readFileSync(process.argv[2]))).join('\n'));
