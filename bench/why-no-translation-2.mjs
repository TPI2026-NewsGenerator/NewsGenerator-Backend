import 'dotenv/config';
import {translatePassages} from '../services/utils/extract.js';
const sentences = [
  "Astronauts Reid Wiseman, Victor Glover, and Christina Koch of NASA and CSA (Canadian Space Agency) astronaut Jeremy Hansen will share highlights from their mission at 7 p.m. CDT Wednesday, Sept. 30, during the free, public event at University of Houston’s Fertitta Center.",
  "Additionally, the National Aeronautic Association will recognize the crew for surpassing the record for human spaceflight’s farthest distance traveled, previously set by the Apollo 13 mission in 1970.",
];
for (let run = 0; run < 3; run++) {
  const translated = await translatePassages([sentences.map(text => ({text, quote: false}))], 'English', 'French');
  console.log(translated ? translated[0].map(s => s.text).join(' | ') : 'NO TRANSLATION');
}
