// the interests of a saved profile as the save writes them (interestsOf, with its second question),
// several times, without saving: node bench/interests-of.mjs <userId> [runs]
import 'dotenv/config';
import {ProfileModel} from '../models/profile-model.js';
import {FeedService} from '../services/feed-service.js';
import * as ollamaModule from '../services/utils/ollama.js';
import {interestsOf} from '../services/utils/profile-ai.js';
const [userId, runs = 3] = process.argv.slice(2).map(Number);
const profile = await ProfileModel.get(userId);
console.log(JSON.stringify({topics: profile.topics, languages: profile.languages, chars: profile.text.length}));
for (let run = 0; run < runs; run++) {
    const interests = await interestsOf({text: profile.text.trim(), topics: [...new Set(profile.topics ?? [])], languages: [...new Set(profile.languages)], categories: FeedService.categories()});
    console.log(`run ${run}: ${interests.length} interests\n   ${interests.map(i => i.text).join('\n   ')}`);
}
process.exit(0);
