// The answer of the AI of the join, its "fait" for each card, on cards given here
//   node --env-file=.env bench/merge-reasons.mjs [titles]   (titles: the lead card says the other titles it holds)
import {mergePrompt} from '../services/utils/profile-ai.js';
import {ollamaJson} from '../services/utils/ollama.js';

const cards = [
    ['Arsenal: Was penalty after Leah Williamson handball the correct decision in Champions League?', process.argv[2] === 'titles'
        ? "Why was Arsenal's Leah Williamson penalized for picking the ball up for a goal kick? Our resident ref, Andy Davies, explains all. Also titled: Women's Champions League VAR review: Why Arsenal's bizarre penalty award was right"
        : "Why was Arsenal's Leah Williamson penalized for picking the ball up for a goal kick? Our resident ref, Andy Davies, explains all."],
    ["La árbitra pita justo antes del gol que daba la victoria al Real Madrid en Champions: “Esto no lo he visto en mi vida”", 'Silvia Cristóbal mandó el balón a la escuadra en el minuto 88 ante el Manchester City, pero la colegiada había hecho sonar el silbato apenas unas décimas antes '],
    ['Le penalty lunaire obtenu par le Paris FC contre Arsenal', "Foot, Ligue des champions (F) Le penalty lunaire qui a sauvé le Paris FC contre Arsenal en Ligue des champions L'arbitre roumaine Elena Demetrescu a accordé un "],
    ['James penalty overturned as Chelsea earn draw in Lyon', "Lauren James saw a late penalty decision overturned by VAR as Chelsea played out a goalless draw away to last season's Women's Champions League finalists and ei"],
    ['Cards, suspensions explained', 'The Champions League, Europa League and Conference League rules on yellow cards, suspensions, when bookings expire and missing the final.'],
].map(([title, description], i) => ({id: String(i), lead: {title, description}}));
for (let run = 0; run < 4; run++) console.log(JSON.stringify((await ollamaJson(mergePrompt(cards))).stories.map(s => `${s.id}->${s.sameAs}`)));
process.exit(0);
