// interestsOf in the process of a save (the service loaded), with the prompt and the answers logged
import 'dotenv/config';
import {ProfileModel} from '../models/profile-model.js';
import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';
import {interestsPrompt, interestsOf} from '../services/utils/profile-ai.js';
const profile = await ProfileModel.get(4);
const written = {text: profile.text.trim(), topics: [...new Set(profile.topics ?? [])], languages: [...new Set(profile.languages)]};
const input = {...written, categories: FeedService.categories()};
console.log(JSON.stringify({topics: input.topics, languages: input.languages, categories: input.categories}));
for (let run = 0; run < 3; run++) console.log(`run ${run}:`, (await interestsOf(input)).map(i => i.text.split(':')[0]).join(' | '));
process.exit(0);
