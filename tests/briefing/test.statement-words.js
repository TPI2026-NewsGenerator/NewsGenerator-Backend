//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.statement-words.js
//  Description: The words of a statement or a communiqué in the languages added for the badge "Official" of the events (the seven of statements.js
//               stay what they were: a card, the API of the news and the alerts do not read these), found in real news of the database
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn(), newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {hasOfficialStatement, statementWordOf} = await import('../../services/utils/statement-words.js');
const {hasStatement} = await import('../../services/utils/statements.js');

describe('statementWordOf', () => {
    it('should find the words of a statement or a communiqué in the languages statements.js does not read', () => {
        expect(statementWordOf('Όπως αναφέρει σε ανακοίνωσή της η Ομοσπονδία Συνδικάτων')).toBe('ανακοίνωσ');
        expect(statementWordOf('Glumci Ateljea 212 izdali saopštenje: Večerašnje predstave počeće u 21 čas')).toBe('saopšten');
        expect(statementWordOf('HKK Široki TT Kabeli oglasio se službenim priopćenjem')).toBe('priopćen');
        expect(statementWordOf('Об этом сообщает пресс-служба Министерства промышленности')).toBe('пресс-служб');
        expect(statementWordOf('Komunikat Polskiego Związku Piłki Nożnej. Z głębokim poruszeniem')).toBe('komunikat');
        expect(statementWordOf('Sigma prohrála, píše se v prohlášení klubu')).toBe('prohlášení');
        expect(statementWordOf('تعلن الصحة الفلسطينية في بيان أن الأجهزة المختصة ضبطت')).toBe('في بيان');
        expect(statementWordOf('アジア杯延期決定にサウジ組織委員会が声明「王国の地位にふさわしい大会を実現する」')).toBe('声明');
        expect(statementWordOf('Det skriver bolaget i ett pressmeddelande')).toBe('pressmeddelande');
        expect(statementWordOf('Zvanično: Mančester junajted počeo pregovore sa Poketinom')).toBe('zvanično');
    });

    it('should not take a word that is the start or the inside of another one for a word of a statement', () => {
        expect(statementWordOf('Demokratska kongresmenka podržala republikanca u Mičigenu')).toBeNull();
        expect(statementWordOf('Skupština Crne Gore obezbijedila donaciju pet komunikatora za djecu sa autizmom')).toBeNull();
        expect(statementWordOf('Njezin horoskopski znak poznat je po šarmu, komunikativnosti i osjećaju za pravednost')).toBeNull();
        expect(statementWordOf('Raquel Martin Skilton ma międzynarodowe doświadczenie')).toBeNull();
        expect(statementWordOf('zloupotrebe službenog položaja prilikom odluke o pomilovanju')).toBeNull();
    });

    it('should answer null for a text with no word, and for no text', () => {
        expect(statementWordOf('Real Madrid beat Villarreal 3-1 at the Bernabeu')).toBeNull();
        expect(statementWordOf(null)).toBeNull();
        expect(statementWordOf('')).toBeNull();
    });
});

describe('hasOfficialStatement', () => {
    it('should read the seven languages of statements.js as it does, and the others besides', () => {
        expect(hasOfficialStatement('The club said in a statement that it will appeal')).toBe(true);
        expect(hasOfficialStatement('La FPF a annoncé dans un communiqué la suspension')).toBe(true);
        expect(hasOfficialStatement('Όπως αναφέρει σε ανακοίνωσή της η ΠΑΕ')).toBe(true);
        expect(hasOfficialStatement('Real Madrid beat Villarreal 3-1 at the Bernabeu')).toBe(false);
    });

    it('should leave statements.js as it was: its seven languages only, for the cards, the API and the alerts', () => {
        expect(hasStatement('Όπως αναφέρει σε ανακοίνωσή της η ΠΑΕ')).toBe(false);
        expect(hasStatement('Glumci Ateljea 212 izdali saopštenje')).toBe(false);
    });
});
