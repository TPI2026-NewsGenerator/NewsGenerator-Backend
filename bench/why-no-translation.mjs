import {ollamaJson} from '../services/utils/ollama.js';
import {keepsFigures} from '../services/utils/extract.js';
const sentences = [
  "The four astronauts of NASA’s Artemis II mission will participate in an event hosted by industry and community partners at the University of Houston to discuss their mission around the Moon aboard the Orion spacecraft.",
  "Astronauts Reid Wiseman, Victor Glover, and Christina Koch of NASA and CSA (Canadian Space Agency) astronaut Jeremy Hansen will share highlights from their mission at 7 p.m. CDT Wednesday, Sept. 30, during the free, public event at University of Houston’s Fertitta Center.",
  "Additionally, the National Aeronautic Association will recognize the crew for surpassing the record for human spaceflight’s farthest distance traveled, previously set by the Apollo 13 mission in 1970.",
];
const prompt = `Translate these sentences of a news article from English into French.
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Answer only in JSON: {"translations": ["...", one per sentence, in the same order]}`;
const answer = await ollamaJson(prompt);
answer.translations.forEach((t, i) => console.log(keepsFigures(sentences[i], t) ? 'OK  ' : 'LOST', t));
