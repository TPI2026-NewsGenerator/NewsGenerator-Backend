//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: hedging.js
//  Description: Words a newspaper uses to say it has no confirmation of what it reports, in the languages of the news, and what makes them
//               no hedge (a rumour the article denies, an "alleged" of a crime report)
//

"use strict"

// This does not judge whether a news is true. It reports how the article presents itself: a paper
// writing "reportedly" or "selon des sources" is telling its reader it could not confirm. A scoop
// from one serious newspaper carries none of these, and a rumour repeated everywhere carries them
// all, which is exactly why this is shown next to the number of media and not mixed into it.
//
// Conditionals ("aurait dit", "would be") are left out on purpose: French and Italian use them for
// ordinary reported speech, so they would mark almost every article.
//
// Measured on 11.11.2026 on 93 news read one by one (bench/hedging/coverage.mjs and find.mjs, 14 days of the database): half of the news
// marked told something else. The "alleged" of a crime report ("arrested after allegedly stealing", "presunto autor") says that the guilt is
// not proved, not that the news is not confirmed (24 of 93, 15 of 19 in Spanish): the words "allegedly", "presunto" and "presuntamente" are no
// longer here (the user, 11.11.2026: option A), nor their kin in the languages where the contexts read were mostly of a crime report
// ("údajně", "rzekomo", "domnevno", "alegadamente", "vermeend", "väitetysti"). They stay where the contexts read said "reportedly" (Hungarian
// "állítólag", Croatian "navodno", Danish "angiveligt"). A rumour that the article denies, says is over or confirms is told as a fact (see
// KILLS_BEFORE and KILLS_AFTER), and the Italian "rumore" is a noise.
// From Greek on (a fifth of the news) no word was found: the languages came in the same day, each word read in its real contexts
// (bench/hedging/verify.mjs). A word is searched in any article, whatever its language: the ones that are an ordinary word or the start of
// one in another language are searched as a word ('|' at the start: a word begins there, at the end: it ends there)

// What the words are, by language: 'said' (a source, a report, an unconfirmed fact) and 'rumour' (a rumour or a speculation exists, the words
// the denials and the confirmations of a rumour are looked for around)
export const WORDS = {
    en: {
        said: ['reportedly', 'according to sources', 'according to reports', 'sources say', 'sources told', 'sources close to', 'source close to',
            'sources familiar', 'anonymous source', 'is said to', 'are said to', 'understood to be', 'it is understood', 'unconfirmed', 'people familiar with'],
        rumour: ['|rumour', '|rumor', 'speculation'],
    },
    fr: {
        said: ['selon des sources', 'selon nos informations', 'selon des informations', 'selon une source', 'selon plusieurs sources', 'selon certaines sources',
            'croit savoir', '|non confirmé', '|sans confirmation', 'aurait été', 'd’après des sources', "d'après des sources", 'se murmure'],
        rumour: ['rumeur'],
    },
    es: {
        said: ['según fuentes', 'fuentes cercanas', 'al parecer', '|sin confirmar', '|no confirmad', 'extraoficiales'],
        rumour: ['|rumor'],
    },
    de: {
        said: ['berichten zufolge', 'insidern zufolge', 'quellen zufolge', 'informationen zufolge', 'angeblich', 'unbestätigt', '|nicht bestätigt'],
        rumour: ['gerücht', 'spekulation'],
    },
    it: {
        said: ['secondo fonti', 'secondo indiscrezioni', 'fonti vicine', 'si vocifera', '|non confermat', 'ufficiosamente'],
        rumour: ['indiscrezioni'],
    },
    pt: {
        said: ['segundo fontes', 'de acordo com fontes', 'fontes próximas', 'fontes ligadas', '|sem confirmação', '|não confirmad', 'diz-se que'],
        rumour: ['|boatos|', 'especulação', 'especula-se'],
    },
    nl: {
        said: ['naar verluidt', 'volgens bronnen', 'volgens ingewijden', 'volgens geruchten', 'onbevestigd'],
        rumour: ['geruchten', 'het gerucht', 'speculatie'],
    },
    ca: {said: ['segons fonts', 'sense confirmar'], rumour: []},
    el: {
        said: ['σύμφωνα με πληροφορίες', 'σύμφωνα με πηγές', 'σύμφωνα με δημοσιεύματα', 'ανεπιβεβαίωτ'],
        rumour: ['φήμες', 'φημολογείται'],
    },
    // Serbian, Croatian, Bosnian and Slovenian, in the two alphabets
    sr: {
        said: ['prema nezvaničnim', 'nezvanično', 'neslužbeno', 'nepotvrđen', 'prema izvorima', 'po nekim izvorima', 'neuradno', 'nepotrjen', 'po neuradnih',
            'према незваничним', 'незванично', 'непотврђен', 'према изворима', '|navodno|', '|наводно|'],
        rumour: ['glasine', 'tračevi', 'spekulacije', 'govorice', 'гласине', 'спекулације'],
    },
    ru: {
        said: ['по неофициальной информации', 'по неофициальным данным', 'неподтвержден', 'неподтверждён', 'по данным источников', 'по информации источников',
            'по словам источника', 'источники сообщают', 'предположительно'],
        rumour: ['по слухам', 'слухи', 'спекуляции'],
    },
    uk: {
        said: ['за неофіційною інформацією', 'непідтверджен', 'за інформацією джерел', 'за даними джерел', 'нібито'],
        rumour: ['чутки', 'за чутками', 'спекуляції'],
    },
    bg: {
        said: ['според неофициална информация', 'непотвърден', 'според източници', 'твърди се'],
        rumour: ['слухове', 'спекулации'],
    },
    mk: {said: ['според неофицијални', 'неофицијално', 'непотврден'], rumour: ['гласини']},
    ar: {
        said: ['بحسب مصادر', 'وفقاً لمصادر', 'وفقا لمصادر', 'وفق مصادر', 'حسب مصادر', 'مصادر مطلعة', 'مصادر مقربة', 'غير مؤكد', 'بحسب تقارير',
            'وفقاً لتقارير', 'وفقا لتقارير', 'تقارير تفيد'],
        rumour: ['شائعات', 'إشاعات', 'إشاعة', 'تكهنات'],
    },
    he: {
        said: ['לפי דיווחים', 'על פי דיווחים', 'לפי מקורות', 'על פי מקורות', 'לא אושר', 'טרם אושר'],
        rumour: ['שמועות', 'שמועה', 'ספקולציות'],
    },
    fa: {said: ['منابع آگاه', 'تایید نشده', 'تأیید نشده', 'به نقل از منابع'], rumour: ['شایعه', 'شایعات']},
    tr: {
        said: ['iddia edildi', 'iddia ediliyor', 'iddialara göre', 'iddiaya göre', 'öne sürüldü', 'kaynaklara göre', 'teyit edilmedi', 'doğrulanmadı',
            'resmi olmayan', 'kulislere göre', 'kulis bilgisi'],
        rumour: ['söylenti', 'spekülasyon'],
    },
    vi: {said: ['theo nguồn tin', 'nguồn tin cho biết', 'chưa được xác nhận', 'chưa xác nhận', 'được cho là'], rumour: ['tin đồn']},
    id: {
        said: ['dikabarkan', 'kabarnya', '|konon|', 'menurut sumber', 'belum dikonfirmasi', 'khabar angin'],
        rumour: ['desas-desus', 'spekulasi'],
    },
    ro: {
        said: ['potrivit surselor', 'conform surselor', 'surse apropiate', 'neconfirmat', 'se pare că', 'informații neoficiale'],
        rumour: ['zvonuri', 'speculații'],
    },
    pl: {
        said: ['nieoficjalnie', 'według nieoficjalnych', 'niepotwierdzon', 'według doniesień'],
        rumour: ['plotki', 'plotka', 'spekulacje'],
    },
    cs: {said: ['nepotvrzen', 'podle zdrojů', 'neoficiálně', 'podle nepotvrzených', '|prý|'], rumour: ['spekulace', 'zvěsti']},
    sk: {said: ['nepotvrden', 'podľa zdrojov', 'neoficiálne', 'podľa nepotvrdených'], rumour: ['špekulácie', 'chýry']},
    hu: {
        said: ['úgy tudjuk', 'értesülések szerint', 'információink szerint', 'források szerint', 'megerősítetlen', 'nem hivatalos', '|állítólag|'],
        rumour: ['pletyka', 'szóbeszéd', 'spekuláció'],
    },
    sv: {said: ['enligt uppgifter', 'enligt källor', 'obekräftad', '|uppges'], rumour: ['|rykten', '|ryktas', 'spekulation']},
    da: {said: ['ifølge kilder', 'efter sigende', 'ubekræftet', '|angiveligt|'], rumour: ['|rygter', 'spekulation']},
    no: {said: ['ifølge kilder', 'etter sigende', 'ubekreftet'], rumour: ['|rykter', '|ryktene', 'spekulasjon']},
    fi: {said: ['lähteiden mukaan', 'lähteen mukaan', 'tietojen mukaan', 'vahvistamat', 'epävirallisesti'], rumour: ['|huhu', 'spekulaatio']},
    lt: {said: ['pasak šaltinių', 'neoficialiais duomenimis'], rumour: ['|gandai', 'spėlionės']},
    lv: {said: ['pēc neoficiālām ziņām', 'neapstiprināt', 'pēc avotu informācijas'], rumour: ['|baumas|', 'spekulācijas']},
    et: {said: ['kuuldavasti', 'allikate teatel', 'kinnitamata', 'mitteametlikel andmetel'], rumour: ['|kuulujut', 'spekulatsioon']},
    sq: {said: ['sipas burimeve', 'sipas zërave', 'pakonfirmuar', 'thuhet se'], rumour: ['thashetheme']},
    // the languages written without spaces: the words are looked for inside the text
    ja: {said: ['関係者によると', '関係者の話', '情報筋', '未確認', 'とみられる'], rumour: ['噂', '憶測']},
    ko: {said: ['것으로 알려졌다', '것으로 전해졌다', '것으로 전해진다', '소식통', '미확인', '관계자에 따르면'], rumour: ['루머', '소문', '추측']},
    zh: {said: ['据传', '據傳', '消息人士', '未经证实', '未經證實', '尚未证实', '尚未證實'], rumour: ['传闻', '傳聞', '谣言', '謠言']},
    th: {said: ['แหล่งข่าว', 'ยังไม่ได้รับการยืนยัน', 'ว่ากันว่า'], rumour: ['ข่าวลือ']},
};

// '|' at the start of a word: a word begins there; at the end: a word ends there ("frygter" and "propagandai" are no "rygter" nor "gandai")
const bare = (marker) => marker.replace(/^\||\|$/g, '');
const MARKERS = [...new Set(Object.values(WORDS).flatMap(language => [...language.said, ...language.rumour]))];
const RUMOURS = new Set(Object.values(WORDS).flatMap(language => language.rumour).map(word => bare(word).toLowerCase()));

// the markers as one regular expression, the longest first so "according to sources" is preferred
// over a shorter one inside it
const escape = (marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_EDGE = String.raw`[\p{L}\p{N}]`;
const alternative = (marker) => `${marker.startsWith('|') ? `(?<!${WORD_EDGE})` : ''}${escape(bare(marker))}${marker.endsWith('|') ? `(?!${WORD_EDGE})` : ''}`;
const PATTERN = new RegExp('(' + [...MARKERS].sort((a, b) => bare(b).length - bare(a).length).map(alternative).join('|') + ')', 'giu');

// ---- what makes a rumour no hedge: the article says it is over, denies it or confirms it, and tells the news as a fact
// A word before it, in the same sentence, that ends, denies or dismisses it ("denies the rumours", "ends weeks of speculation", "balaie les
// rumeurs", "no longer a rumor", "despite rumors"), or a duration that says it lasted ("after months of speculation")
const sentence = String.raw`[^.!?:;|\n]{0,60}$`;
const lead = (words) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${words.join('|')})(?![\p{L}])` + sentence, 'iu');
const KILLS_BEFORE = lead([
    // English
    String.raw`end(?:s|ed|ing)?`, String.raw`false`, String.raw`baseless`, String.raw`unfounded`, String.raw`no longer`, String.raw`not an?`, String.raw`more than an?`, 'despite', String.raw`shut(?:s|ting)? down`,
    String.raw`laugh(?:s|ed|ing)? off`, String.raw`rul(?:e|es|ed|ing) out`, String.raw`reject(?:s|ed|ing)?`, String.raw`dismiss(?:es|ed|ing)?`,
    String.raw`den(?:y|ies|ied|ying)`, String.raw`quash(?:es|ed|ing)?`, String.raw`squash(?:es|ed|ing)?`, String.raw`dispel(?:s|led|ling)?`,
    String.raw`debunk(?:s|ed|ing)?`, String.raw`push(?:es|ed|ing)? back`, String.raw`brush(?:es|ed|ing)? off`, String.raw`put(?:s|ting)? (?:an end|to rest)`,
    String.raw`scotch(?:es|ed|ing)?`, String.raw`clear(?:s|ed|ing)? up`, String.raw`slam(?:s|med|ming)?`, String.raw`hit(?:s|ting)? out at`,
    String.raw`after\s+(?:\p{L}+\s+){0,2}(?:weeks|days|months|years)\s+of`,
    // French
    String.raw`faux`, String.raw`fausses?`, String.raw`balaie\p{L}*`, String.raw`balay\p{L}*`, String.raw`dément\p{L}*`, String.raw`démenti\p{L}*`, String.raw`(?:faire|fait|font) taire`, String.raw`mett\p{L}* fin`,
    String.raw`mis fin`, String.raw`fin (?:à|aux|des|de la)`, 'coupe court', String.raw`écart\p{L}*`, String.raw`rejett?\p{L}*`, 'malgré', String.raw`n['’]est plus`,
    String.raw`dissip\p{L}*`, String.raw`réfut\p{L}*`, String.raw`après\s+(?:\p{L}+\s+){0,2}(?:semaines|jours|mois|années|ans)\s+de`,
    // Spanish
    String.raw`falsos?`, String.raw`falsas?`, String.raw`infundad\p{L}*`, String.raw`desmient\p{L}*`, String.raw`desmint\p{L}*`, String.raw`desment\p{L}*`, String.raw`nieg\p{L}*`, String.raw`neg[óo]`, String.raw`pon(?:e|en|er|ía)? fin`,
    String.raw`puso fin`, String.raw`fin a`, String.raw`acab(?:a|ó|an) con`, String.raw`aclar\p{L}*`, 'zanja', String.raw`descart\p{L}*`, String.raw`pese a`, String.raw`a pesar de`,
    String.raw`ya no es`, String.raw`disip\p{L}*`, String.raw`rechaz\p{L}*`, String.raw`tras\s+(?:\p{L}+\s+){0,2}(?:semanas|días|meses|años)\s+de`,
    // German
    String.raw`falsche\p{L}*`, String.raw`haltlose\p{L}*`, String.raw`dementier\p{L}*`, String.raw`bestreit\p{L}*`, String.raw`beend\p{L}*`, String.raw`ende der`, 'ein ende', String.raw`räumt auf`, String.raw`kein\p{L}*`, 'trotz',
    String.raw`nach\s+(?:\p{L}+\s+){0,2}(?:wochen|tagen|monaten|jahren)`,
    // Italian
    String.raw`fals[eio]`, String.raw`infondat\p{L}*`, String.raw`smen\p{L}*`, String.raw`fine (?:alle|ai|dei|delle|della)`, String.raw`non è più`, String.raw`conferm\p{L}*`, String.raw`respin\p{L}*`, 'nonostante',
    String.raw`dopo\s+(?:\p{L}+\s+){0,2}(?:settimane|giorni|mesi|anni)\s+di`,
    // Portuguese
    String.raw`neg(?:a|ou|aram)`, String.raw`rebat\p{L}*`, String.raw`afast(?:a|ou|aram|ando)`, String.raw`põe\w* fim`, String.raw`acab(?:a|ou) com`, String.raw`fim d(?:os|as|e)`,
    String.raw`apesar d(?:os|as|e)`, String.raw`depois\s+d[eao]s?\s+(?:\p{L}+\s+){0,2}(?:semanas|dias|meses|anos)\s+de`,
    // Dutch
    String.raw`ontken\p{L}*`, String.raw`maakt een einde`, String.raw`einde aan`,
    // Greek
    String.raw`διαψ\p{L}*`, String.raw`διέψ\p{L}*`, String.raw`τέλος στ\p{L}*`,
    // Serbian, Croatian, Bosnian, Slovenian
    String.raw`odbac\p{L}*`, String.raw`demant\p{L}*`, String.raw`opovrg\p{L}*`, String.raw`pori[cč]\p{L}*`, String.raw`rasprš\p{L}*`, String.raw`razbij\p{L}*`,
    String.raw`одбац\p{L}*`, String.raw`демант\p{L}*`, String.raw`порич\p{L}*`, String.raw`zanika\p{L}*`, String.raw`ovrže\p{L}*`,
    // Russian, Ukrainian, Bulgarian
    String.raw`опроверг\p{L}*`, String.raw`опроверж\p{L}*`, String.raw`отверг\p{L}*`, String.raw`развеял\p{L}*`, String.raw`отрицал\p{L}*`, String.raw`отрицает`,
    String.raw`заперечив\p{L}*`, String.raw`заперечу\p{L}*`, String.raw`розвіяв\p{L}*`, String.raw`спростув\p{L}*`, String.raw`отрече\p{L}*`, String.raw`разпръсна\p{L}*`,
    // Hebrew
    String.raw`הכחיש\p{L}*`, 'הדף',
    // Indonesian
    String.raw`bantah\p{L}*`, String.raw`membantah`, String.raw`tepis\p{L}*`, String.raw`menepis`, String.raw`mengesampingkan`, String.raw`sanggah\p{L}*`,
    // Romanian, Polish, Slovak, Latvian, Estonian
    String.raw`lükk\p{L}*`,
    String.raw`dezmin\p{L}*`, String.raw`infirm\p{L}*`, String.raw`elimin\p{L}*`, 'pune capăt', String.raw`przecin\p{L}*`, String.raw`ucin\p{L}*`, String.raw`dementuj\p{L}*`,
    String.raw`zaprzecz\p{L}*`, String.raw`odrzuc\p{L}*`, String.raw`odpier\p{L}*`, String.raw`odmít\p{L}*`, String.raw`odmiet\p{L}*`, String.raw`rozptýl\p{L}*`, String.raw`poprel\p{L}*`, String.raw`noliedz\p{L}*`, String.raw`noraid\p{L}*`, String.raw`atspēk\p{L}*`,
]);
// A word after it, in the same sentence, that says it is false, denied or confirmed ("a rumour denied", "rumours that he will leave are false"),
// and the verbs that come last in the languages that put them last (Persian, Korean, Japanese, Estonian), the last ones with no edge of a word:
// a Korean or a Japanese verb is followed by its ending
const KILLS_AFTER = new RegExp(String.raw`^[^.!?:;|\n]{0,50}?(?:(?<![\p{L}\p{N}])(?:` + [
    String.raw`denied`, String.raw`dismissed`, String.raw`debunked`, String.raw`(?:is|are|was|were|now) (?:false|untrue|baseless|nonsense|true|over)`, 'put to rest', 'shut down',
    String.raw`(?:is|are|was|were|been|now|finally|officially) confirmed`, String.raw`se confirm[óo]`, String.raw`confirmaron`,
    String.raw`démenti\p{L}*`, String.raw`infondé\p{L}*`, String.raw`fausses?`, String.raw`confirmé\p{L}*`, String.raw`balayé\p{L}*`,
    String.raw`desmentid\p{L}*`, String.raw`falsos?`, String.raw`infundad\p{L}*`, String.raw`confirmad\p{L}*`, String.raw`neg[óo]`, String.raw`negaron`, String.raw`niega\p{L}*`,
    String.raw`dementiert`, 'haltlos', 'falsch', 'unwahr', String.raw`bestätigt`,
    String.raw`smentit\p{L}*`, String.raw`smentisc\p{L}*`, String.raw`infondat\p{L}*`, String.raw`confermat\p{L}*`,
    String.raw`negou`, String.raw`desmentiu`, String.raw`ontkent`, String.raw`onwaar`, String.raw`bevestigd`,
    'تکذیب', 'رد کرد', 'رد شد', 'صحت ندارد', 'ümber lükk', String.raw`lükkas ümber`,
].join('|') + String.raw`)(?![\p{L}])|사실무근|부인|일축|否定|一蹴)`, 'iu');
// "after the rumours of the week" does not make one a fact by itself: only when the same text confirms something
const AFTERWORD = new RegExp(String.raw`(?<![\p{L}])(?:after|following|nach|dopo|après|tras|após|depois d[eao]s?)\s+(?:[\p{L}'’-]+\s+){0,2}$`, 'iu');
const CONFIRMS = /(?<![\p{L}])(?:confirm|conferm|official|officiel|offiziell|ufficial|oficial|bestätig|announce|annonc|anunci|unveil)/iu;
// "rumor" begins the Italian "rumore" and "rumori" (a noise), "rumoroso" and the German "rumort", "rumoren"; "especulação imobiliária" is a speculation on land
const NOISE = {rumor: /^(?:[ei]|os[aeio]|ts?|en)(?![\p{L}])/iu, especulação: /^\s+(?:imobili|financeir)/iu};

// whether the word found at 'at' of the text says nothing of the news after all
const neutral = (word, text, at) => {
    const after = text.slice(at + word.length);
    if (NOISE[word]?.test(after)) return true;
    if (!RUMOURS.has(word)) return false;
    const before = text.slice(Math.max(0, at - 100), at);
    return KILLS_BEFORE.test(before) || KILLS_AFTER.test(after) || (AFTERWORD.test(before) && CONFIRMS.test(text));
};

// the words the article used to hedge, null when it states its news plainly (or says the rumour is over, denied, or confirmed)
export const hedgedBy = (...texts) => {
    const text = texts.filter(Boolean).join('\n');
    for (const found of text.matchAll(PATTERN)) {
        const word = found[1].toLowerCase();
        if (!neutral(word, text, found.index)) return word;
    }
    return null;
};
