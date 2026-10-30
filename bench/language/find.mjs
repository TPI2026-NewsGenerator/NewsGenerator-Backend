// the feed findFeeds gives for favorflav.com on gastronomy, with and without the reader's languages
import 'dotenv/config';
import {findFeeds} from '../../services/utils/feed-finder.js';
const subject = ['gastronomie restaurant chef étoilé Michelin', 'restaurant'];
for (const languages of [null, ['fr', 'en']]) {
    const feeds = await findFeeds('favorflav.com', {language: 'fr', subject, languages});
    console.log(languages, feeds.slice(0, 4).map(f => ({url: f.url.slice(0, 90), language: f.language, onSubject: f.onSubject})));
}
