import pg from 'pg';
import {interestSearchUrls} from '../services/utils/google-news.js';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const interests = (await c.query(`SELECT text, searches FROM profile_interests WHERE id_user = 311`)).rows;
const media = ['geo.fr', 'science-et-vie.com', 'chron.com', 'scanvoile.com', 'sailingscuttlebutt.com', 'courseaularge.com', 'caltech.edu', 'sailworldcruising.com'];
for (const {text, searches} of interests) {
    const urls = interestSearchUrls(searches, ['fr', 'en']);
    const rows = (await c.query(`SELECT DISTINCT a.medium FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url = ANY($1::text[]) AND a.medium = ANY($2::text[])`, [urls, media])).rows;
    console.log(text.slice(0, 30), '| named by Google:', rows.map(r => r.medium).join(', '));
}
await c.end();
