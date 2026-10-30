import fs from 'node:fs';
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.split(a).join(b); };
rep("const isName = (entity) => entity.split(/[\s'’-]+/).some(w => /^\p{Lu}/u.test(w) && !DETERMINERS.has(strip(w)));",
"// ... and a name does not end in a common noun (\"Spanish referees\", \"French clubs\", \"Football federations\")\nconst isName = (entity) => entity.split(/[\s'’-]+/).some(w => /^\p{Lu}/u.test(w) && !DETERMINERS.has(strip(w)))\n    && !/^\p{Ll}/u.test(entity.split(/\s+/).at(-1));");
rep("const cardFigures = (text) => new Set([...figuresOf(text), ...spelledThousands(text), ...afternoonHours(text),",
"// a year of the cards also stands for its last two figures (the season \"2020-21\" of \"2020-2021\")\nconst shortYears = (text) => ((text ?? '').match(/\b(?:19|20)\d{2}\b/g) ?? []).map(y => y.slice(2).replace(/^0/, '').replace(/0+$/, '') || '0');\nconst cardFigures = (text) => new Set([...figuresOf(text), ...spelledThousands(text), ...afternoonHours(text), ...shortYears(text),");
fs.writeFileSync(f, s);
