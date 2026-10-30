// starts a briefing for a test reader through the API, as the "New briefing" button does
// node bench/start-briefing.mjs [username]
import fs from 'node:fs';
const username = process.argv[2] ?? 'lecteur-difficile';
const account = fs.readFileSync(new URL('./test-account.local.md', import.meta.url), 'utf8').split(`- username: ${username}`)[1];
const password = account.match(/- password: (\S+)/)[1];
const API = 'http://localhost:3001/api';
const login = await (await fetch(`${API}/login`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, password})})).json();
const token = login.token ?? login.accessToken ?? Object.values(login).find(v => typeof v === 'string' && v.split('.').length === 3);
const res = await fetch(`${API}/briefing`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}});
console.log(`briefing for ${username}: HTTP ${res.status}`, JSON.stringify(await res.json().catch(() => null)).slice(0, 200));
