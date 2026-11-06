//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: test.title-translation.js
//  Description: The language of a title read from its letters (a Persian paper in an English feed, a Czech one), and the titles
//               translated into the language of the reader accordingly: only the ones that are in another language, in calls of 25
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson}));
const {scriptLanguage, titleLanguage, writtenIn} = await import('../../services/utils/language.js');
const {translatedTitles} = await import('../../services/utils/title-translation.js');

const PERSIAN = 'افشاگری لوموند: فیفا مالیات‌های رئیس خود را در امریکا پرداخت کرده است';
const CZECH = '„Můj cíl je jasný: sloužit fotbalu a lidem.“ Infantino má překvapivého vyzyvatele';
const NAMES = 'Mbappé and Müller shine as Ødegaard returns for Arsenal';

// the AI answers one translation per text, "T:" and the title
const translates = () => ollamaJson.mockImplementation(async (prompt) => ({
    translations: [...prompt.matchAll(/^\[\d+\] \([^)]*\) (.*)$/gm)].map(match => `T: ${match[1]}`),
}));

beforeEach(() => ollamaJson.mockReset());

describe('scriptLanguage', () => {
    it('should name the language of a title by its letters when they are not Latin', () => {
        expect(scriptLanguage(PERSIAN)).toBe('fa');
        // the label of a feed of the script stands (franc takes a short Russian title for Bulgarian), else the guess
        expect(scriptLanguage('Инфантино: у ФИФА нет денег на всех', 'ru')).toBe('ru');
        expect(scriptLanguage('Инфантино: у ФИФА нет денег на всех', 'en')).not.toBe('en');
        expect(scriptLanguage('Ο Ινφαντίνο απαντά στην UEFA')).toBe('el');
        expect(scriptLanguage('インファンティーノ会長が辞任を否定')).toBe('ja');
        expect(scriptLanguage('国际足联主席因凡蒂诺否认辞职')).toBe('zh');
    });

    // the languages of a script of their own, which the list had not (the user, 06.11.2026: "éviter problème de langue plus tard")
    it('should name the languages of India, South-East Asia and Ethiopia by their letters, whatever the label of their feed', () => {
        const titles = {
            ta: 'ஃபிஃபா நடுவர் விதிகளில் மாற்றங்களை அறிவித்துள்ளது இன்று', te: 'ఫిఫా రిఫరీ నియమాలలో మార్పులను ప్రకటించింది ఈ రోజు',
            kn: 'ಫಿಫಾ ರೆಫರಿ ನಿಯಮಗಳಲ್ಲಿ ಬದಲಾವಣೆಗಳನ್ನು ಘೋಷಿಸಿದೆ ಇಂದು', ml: 'ഫിഫ റഫറി നിയമങ്ങളിൽ മാറ്റങ്ങൾ പ്രഖ്യാപിച്ചു ഇന്ന്',
            gu: 'ફિફાએ રેફરીના નિયમોમાં ફેરફારની જાહેરાત કરી છે આજે', pa: 'ਫੀਫਾ ਨੇ ਰੈਫਰੀ ਦੇ ਨਿਯਮਾਂ ਵਿੱਚ ਬਦਲਾਅ ਦਾ ਐਲਾਨ ਕੀਤਾ ਹੈ ਅੱਜ',
            si: 'ෆීෆා ආයතනය විනිසුරු නීතිවල වෙනස්කම් නිවේදනය කළා අද', km: 'ហ្វីហ្វាប្រកាសការផ្លាស់ប្តូរច្បាប់អាជ្ញាកណ្តាលនៅថ្ងៃនេះ',
            lo: 'ຟີຟາປະກາດການປ່ຽນແປງກົດລະບຽບຜູ້ຕັດສິນມື້ນີ້ແລ້ວ', my: 'ဖီဖာက ဒိုင်လူကြီးစည်းမျဉ်းများ ပြောင်းလဲကြောင်း ကြေညာခဲ့သည်',
            am: 'ፊፋ በዳኝነት ህጎች ላይ ለውጦችን ማወጁን ዛሬ አስታወቀ',
        };
        for (const [code, title] of Object.entries(titles)) {
            expect(scriptLanguage(title)).toBe(code);
            expect(titleLanguage(title, 'en')).toEqual({language: code, guessed: false});
            expect(writtenIn(code)).not.toBeNull();
        }
    });

    it('should read a Serbian title in Cyrillic as Serbian, with a label or without', () => {
        const title = 'Званично: Нема кандидата за председника Фудбалског савеза Србије!';
        expect(titleLanguage(title, null)).toEqual({language: 'sr', guessed: false});
        expect(titleLanguage(title, 'en')).toEqual({language: 'sr', guessed: false});
        expect(titleLanguage(title, 'sr')).toEqual({language: 'sr', guessed: false});
    });

    it('should translate the languages a feed labels but the words cannot read: Icelandic, Welsh, Basque, Hausa...', () => {
        for (const code of ['is', 'cy', 'eu', 'ha', 'so', 'mt', 'ga', 'nb']) expect(writtenIn(code)).not.toBeNull();
        // and still not a code that is no language
        expect(writtenIn('zz')).toBeNull();
    });

    it('should say nothing of a title in Latin letters, or with too few letters', () => {
        expect(scriptLanguage('FIFA faces fresh transparency questions')).toBeNull();
        expect(scriptLanguage(CZECH)).toBeNull();
        expect(scriptLanguage('2026')).toBeNull();
    });
});

describe('titleLanguage', () => {
    it('should read a Persian title as Persian whatever the label of its feed', () => {
        expect(titleLanguage(PERSIAN, 'en')).toEqual({language: 'fa', guessed: false});
    });

    it('should read the short words of a French or German title labelled English', () => {
        expect(titleLanguage('La FIFA recule sous la pression et dévoile les documents', 'en')).toEqual({language: 'fr', guessed: false});
        expect(titleLanguage('Der Präsident der FIFA weist die Vorwürfe zurück', 'en')).toEqual({language: 'de', guessed: false});
    });

    it('should guess a Czech title labelled English from its accents, and say it is a guess', () => {
        const read = titleLanguage(CZECH, 'en');
        expect(read.guessed).toBe(true);
        expect(read.language).not.toBe('en');
    });

    it('should not take a Slovak title labelled English for Bosnian: á, é, ú and ý are no letters of Croatian nor of Bosnian (ta3.com, 6.11.2026)', () => {
        const read = titleLanguage('Podcenili ste to, odkázalo vedenie svetového hokeja. IIHF kritizuje súd za to, že vrátili Rusov do hry', 'en');
        expect(read.guessed).toBe(true);
        expect(['sk', 'cs']).toContain(read.language);
    });

    it('should still read a Croatian title with its own letters as such', () => {
        const read = titleLanguage('Čeferin: šampioni će igrati u Zagrebu, ždrijeb je u petak', 'en');
        expect(['hr', 'bs']).toContain(read.language);
    });

    it('should leave an English title and its label alone', () => {
        expect(titleLanguage('FIFA faces fresh transparency questions after $4m payment to Infantino’s US tax bill', 'en')).toEqual({language: 'en', guessed: false});
        expect(titleLanguage('UEFA’s Čeferin says he will run again for a third term', 'en')).toEqual({language: 'en', guessed: false});
    });
});

describe('translatedTitles', () => {
    it('should translate a Persian and a Czech title labelled English, and leave an English one', async () => {
        translates();
        const answers = await translatedTitles([
            {title: PERSIAN, label: 'en'}, {title: 'FIFA faces fresh transparency questions', label: 'en'}, {title: CZECH, label: 'en'},
        ], 'en');
        expect(answers[0]).toEqual({language: 'fa', translation: `T: ${PERSIAN}`});
        expect(answers[1]).toEqual({language: 'en', translation: null});
        expect(answers[2].translation).toBe(`T: ${CZECH}`);
        expect(answers[2].language).not.toBe('en');
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should keep an English title with accented names as it is when the translation is the same text', async () => {
        ollamaJson.mockResolvedValue({translations: [NAMES]});
        expect(await translatedTitles([{title: NAMES, label: 'en'}], 'en')).toEqual([{language: 'en', translation: null}]);
    });

    it('should translate a title of a language the label gives right, for a reader of another', async () => {
        translates();
        const [answer] = await translatedTitles([{title: 'La FIFA recule sous la pression et dévoile les documents', label: 'fr'}], 'en');
        expect(answer).toEqual({language: 'fr', translation: 'T: La FIFA recule sous la pression et dévoile les documents'});
    });

    it('should ask 25 titles at a time, and answer none for a call that fails', async () => {
        translates();
        await translatedTitles(Array.from({length: 30}, () => ({title: PERSIAN, label: 'en'})), 'en');
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        ollamaJson.mockReset().mockRejectedValue(new Error('down'));
        const answers = await translatedTitles([{title: PERSIAN, label: 'en'}], 'en');
        expect(answers).toEqual([{language: 'fa', translation: null}]);
    });

    it('should ask nothing when every title is in the language of the reader', async () => {
        expect(await translatedTitles([{title: 'FIFA faces fresh transparency questions', label: 'en'}], 'en')).toEqual([{language: 'en', translation: null}]);
        expect(ollamaJson).not.toHaveBeenCalled();
    });
});
