//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: make-api-key.js
//  Description: Makes the key of a client of /api/v1 (see services/utils/api-key.js). The key is shown once, to be
//               sent to its owner and kept nowhere else; the line to add to api.env holds only its SHA-256.
//               Nothing is written, nothing is sent
//
//  node scripts/make-api-key.js footballiq       (pnpm run api-key footballiq)
//

import process from 'node:process';
import {hashOfKey, newApiKey} from '../services/utils/api-key.js';

const name = process.argv[2];
if (!/^[a-z0-9_-]{1,40}$/i.test(name ?? '')) {
    console.error('Usage: node scripts/make-api-key.js <name of the client>   (letters, digits, - and _, 40 at most)');
    process.exit(1);
}

const key = newApiKey();
console.log(`
Key of ${name}. It is shown once: send it to them (a password manager, Signal), never in a document or a
repository. They put it in the configuration of THEIR server and send it as   Authorization: Bearer <key>

  ${key}

On the server, in ~/newsgenerator/api.env, the line below (API_KEYS already there: add a comma and the
entry, ${name}:<hash>), then restart the api container as after any change of api.env. Only the hash goes
there: the file gives no key to whoever reads it.

  API_KEYS=${name}:${hashOfKey(key)}

To revoke the key, take its entry out and restart: nothing else changes.
`);
