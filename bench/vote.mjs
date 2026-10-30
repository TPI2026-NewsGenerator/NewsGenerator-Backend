// a thumb of the test reader lecteur-difficile through the API, as the page gives it
// node bench/vote.mjs <briefingId> <storyId> <up|down|null>
import fs from 'node:fs';
const [briefingId, storyId, vote] = process.argv.slice(2);
const account = fs.readFileSync(new URL('./test-account.local.md', import.meta.url), 'utf8').split('- username: lecteur-difficile')[1];
const password = account.match(/- password: (\S+)/)[1];
const API = 'http://localhost:3001/api';
const login = await (await fetch(`${API}/login`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'lecteur-difficile', password})})).json();
const token = login.token ?? login.accessToken ?? Object.values(login).find(v => typeof v === 'string' && v.split('.').length === 3);
const res = await fetch(`${API}/briefing/${briefingId}/vote`, {method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify({storyId: Number(storyId), vote: vote === 'null' ? null : vote})});
console.log(`vote ${vote} on story ${storyId} of briefing ${briefingId}: HTTP ${res.status}`);
