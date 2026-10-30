// Saves the profile of a reader as the profile page does (the AI reads it, the sources are found
// again), and waits for the discovery to end. Run inside the API container:
//   docker exec -i newsgenerator-api node --input-type=module - <userId> <languages,comma> < this file
// with the text of the profile in /tmp/profile.txt
import {readFileSync} from 'node:fs';
import {ProfileService} from '/app/services/profile-service.js';
import {ProfileModel} from '/app/models/profile-model.js';
import {guardFetch} from '/app/services/utils/public-url.js';

guardFetch();
const userId = Number(process.argv[2]);
const languages = process.argv[3].split(',');
const text = readFileSync('/tmp/profile.txt', 'utf8').trim();
const started = Date.now();

console.error(`languages offered: ${(await ProfileService.languagesOf(userId)).join(', ')}`);
const saved = await ProfileService.save(userId, {text, topics: [], languages});
console.error(`saved in ${Math.round((Date.now() - started) / 1000)} s: ${saved.interests.length} interests`);
for (const interest of saved.interests) {
    console.error(`- ${interest.weight} ${interest.text}\n  keywords: ${interest.keywords}`);
}
for (;;) {
    const {discovery_status: status} = await ProfileModel.get(userId);
    if (status !== 'running') {
        console.error(`discovery ${status} after ${Math.round((Date.now() - started) / 1000)} s`);
        break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
}
process.exit(0);
