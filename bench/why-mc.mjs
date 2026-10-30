import {prisma} from '../config/db.js';
import {mediaFor} from '../services/utils/media-cloud.js';
import {search} from '../services/utils/google-news.js';
import {knownMedia} from '../services/source-service.js';
import {nameOf} from '../services/utils/public-url.js';
const rows = await prisma.$queryRawUnsafe(`SELECT position, searches FROM profile_interests WHERE id_user = 384 ORDER BY position`);
const known = await knownMedia(384);
for (const {position, searches} of rows) {
    console.log('interest', position, searches);
    const [lang, q] = searches[0].split(/:(.+)/);
    const mc = await mediaFor(q, {language: lang});
    const g = await search([q], {days: 7, language: lang});
    const byGoogle = new Set(g.media.map(m => nameOf(m.site)));
    console.log(' MC', mc.length, mc.slice(0, 15).map(m => `${m.site}(${m.news})${known.has(nameOf(m.site)) ? '[known]' : ''}${byGoogle.has(nameOf(m.site)) ? '[google]' : ''}`).join(' '));
    break;
}
await prisma.$disconnect();
