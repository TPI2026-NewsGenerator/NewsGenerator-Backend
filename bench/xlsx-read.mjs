// reads a file as the client does (client/src/features/briefing/importFile.js), with the DOM of jsdom
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../client/package.json', import.meta.url));
const {JSDOM} = require('jsdom');
globalThis.DOMParser = new JSDOM().window.DOMParser;
const {addressesOfXlsx} = await import('../../client/src/features/briefing/importFile.js');
const found = addressesOfXlsx(new Uint8Array(readFileSync(process.argv[2])));
console.log(found.length, found.slice(0, 5));
