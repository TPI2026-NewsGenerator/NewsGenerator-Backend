import {exactItems} from '../services/utils/wikidata.js';
for (const [name, lang] of [['LFF', 'en'], ['Latvian Football Federation', 'en'], ['Latvijas Futbola federācija', 'lv'], ['Fédération lettone de football', 'fr'],
    ['Lettlands Fussballverband', 'de'], ['Gianni Infantino', 'en'], ['Infantino', 'en'], ['Paris', 'fr'], ['UEFA', 'en'], ['Aleksander Čeferin', 'en'],
    ['Vadims Ļašenko', 'en'], ['Latvia', 'en'], ['Lettonie', 'fr'], ['FIFA', 'de'], ['Donald Trump', 'en'], ['Apple', 'en'], ['Ligue 1', 'fr']]) {
    console.log(name, lang, await exactItems(name, lang));
    await new Promise(r => setTimeout(r, 500));
}
