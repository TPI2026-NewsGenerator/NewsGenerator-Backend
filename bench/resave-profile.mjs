// a profile saved again as it is, as the Profile page does, and its discovery waited for:
// node bench/resave-profile.mjs <userId>
import 'dotenv/config';
import {ProfileModel} from '../models/profile-model.js';
import {ProfileService} from '../services/profile-service.js';
import {DiscoveryService} from '../services/discovery-service.js';
const userId = Number(process.argv[2]);
const profile = await ProfileModel.get(userId);
const saved = await ProfileService.save(userId, {text: profile.text, topics: profile.topics ?? [], languages: profile.languages});
saved.interests.forEach(i => console.log(`w${i.weight} ${i.text}\n   kw: ${i.keywords}`));
const started = Date.now();
while (DiscoveryService.isRunning(userId)) await new Promise(resolve => setTimeout(resolve, 5000));
const after = await ProfileService.get(userId);
console.log(`discovery ${after.discovery?.status ?? JSON.stringify(after.discovery)} in ${Math.round((Date.now() - started) / 1000)} s, ${after.sources?.length} sources`);
process.exit(0);
