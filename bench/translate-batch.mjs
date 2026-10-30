// The titles and descriptions of a few cards translated together, as the client asks them
//   node --env-file=.env bench/translate-batch.mjs
import {translateTexts} from '../services/utils/extract.js';

const texts = [
    {from: 'English', text: 'Late Real Madrid winner ruled out as Man City earn Champions League draw'},
    {from: 'English', text: 'James penalty overturned as Chelsea earn draw in Lyon'},
    {from: 'English', text: "Lauren James saw a late penalty decision overturned by VAR as Chelsea played out a goalless draw away to last season's Women's Champions League finalists and eight-time winners Lyon."},
    {from: 'English', text: 'Cards, suspensions explained'},
];
for (let i = 0; i < 4; i++) console.log(JSON.stringify((await translateTexts(texts, 'French')).map(t => t?.slice(0, 50) ?? null)));
process.exit(0);
