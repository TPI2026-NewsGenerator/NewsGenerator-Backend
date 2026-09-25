//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: judged-pairs.js
//  Description: The pairs read and judged by hand that every grouping measure is scored against.
//               Kept apart from the bench so a second bench (scripts/bge-hybrid.py, which needs
//               Python for the sparse and ColBERT parts of BGE-M3) is judged on the same set.
//

"use strict"

// What a right answer looks like. Every article is named by a piece of its title, read and judged
// by hand in the searches of the last days. A measure is only worth something if one threshold
// catches all of the first list and none of the second.
//
// SAME: the same event. Different papers, different words, one fact.
// APART: the hard negatives — they look alike and are not the same news. A template its paper puts
// around unrelated matches, a daily market report, a subject followed over days.

export const SAME = {
    // English
    higuain: ['Columbus Crew sack coach Federico Higua', 'brother sacked by MLS club',
        'MLS coach sacked after sexist remark', 'Columbus Crew reserve team coach fired',
        'Crew 2 fires Higuain after fallout'],
    realMadrid: ['Real Madrid referee row rages on', 'Furious Real Madrid turn on',
        'Real Madrid call for La Liga president'],
    merz: ['Merz Pledges to Stay On', 'Merz Vows to Stay After Another'],
    mamdani: ['Netanyahu accuses Mamdani', 'Netanyahu Attacks Mamdani', 'Netanyahu says of Mamdani',
        'Netanyahu Falsely Accuses Mamdani'],
    irelandIsrael: ['Ireland manager responds to Israel criticism', 'Israel accuse Ireland manager',
        "Israel's FA accuse Ireland manager", "Hallgrimsson accused of 'ignorance",
        "Israel FA accuses Hallgrimsson"],
    // Spanish
    zapatero: ['Zapatero sostiene que Arabia Saud', 'Zapatero asegura que las joyas',
        'Zapatero alega ante el juez', 'Zapatero asegura al juez que las joyas'],
    querola: ['Así era La Querola', 'El fuego destruye La Querola', 'Un incendio destruye la lujosa'],
    // French
    hakimi: ['Achraf Hakimi sera jug', 'Affaire Hakimi : un proc', 'Cour de cassation confirme le renvoi',
        "Cour de cassation rejette le pourvoi d'Achraf", 'Débouté par la Cour de cassation',
        'la Cour de cassation a tranché'],
    brun: ['Philippe Brun ne sera pas r', 'justice rejette la demande de r',
        'Écarté de la primaire de la gauche', 'ne pourra réintégrer'],
    // Italian
    ocse: ['Ocse rivede al rialzo la crescita', 'Ocse rivede al rialzo stime pil',
        'Ocse rivede al rialzo le stime del pil'],
};

export const APART = {
    bettingTips: ['Egypt vs Angola Prediction', 'Togo vs Burundi Prediction',
        'Sudan vs Ethiopia Prediction', 'UAE vs Yemen Prediction'],
    ipbl: ['3 interesting facts about Mihika', '3 interesting facts about Armaan',
        '3 interesting facts about Harsh'],
    borsa: ['Borsa: Milano chiude in calo', 'La Borsa di Milano apre in rialzo',
        "Borsa: l'Europa rallenta malgrado"],
    howToWatch: ['How to Watch Nebraska vs. Missouri', 'South Africa vs Australia ODIs, live streaming'],
    // one subject, several days, several events: the card must not call this one news
    unAssembly: ['U.N. General Assembly Traffic and Street Closures', "Trump Threatens Iran’s ‘Annihilation’",
        'Macron to Make His Final U.N. General Assembly'],
    marketTalk: ['Health Care Roundup: Market Talk', 'Auto & Transport Roundup: Market Talk'],
};

// The same judgement across languages, for a grouping that reads every language at once. Each key
// of CROSS_SAME extends the set of the same name in SAME with the same fact told in other languages
// (or opens a new one). CROSS_APART holds the trap of a multilingual model: one subject, one day,
// several facts. The OECD publishes one report and every country writes about its own figure: an
// article on Italy's growth does not corroborate Spain's.
export const CROSS_SAME = {
    hakimi: ['Achraf Hakimi to face trial', "PSG's Achraf Hakimi will be tried",
        'El Supremo francés confirma que Achraf Hakimi', 'Achraf Hakimi será juzgado',
        'Hakimi scheitert mit Berufung', 'PSG-Star Hakimi muss vor Gericht'],
    higuain: ['Federico Higuaín es cesado', 'El hermano de Higuaín, expulsado', 'le frère de Gonzalo Higuain viré'],
    merz: ['Merz se aferra a las reformas', 'Durchhalteparolen nach dem Desaster'],
    sanchezMamdani: ['Sánchez y Mamdani reivindican', 'España muestra que otro modelo económico',
        'Sánchez exhibe sintonía con Mamdani', 'Mamdani and Spain’s Sánchez forge'],
    oecdGlobal: ['Global Economy Stronger Than Expected, But Threats Mount', 'global economy more resilient to Iran war',
        'Pil globale ha retto meglio del previsto'],
};

export const CROSS_APART = {
    oecdCountries: ['La OCDE mejora la previsión de PIB de España', 'OECD hebt Konjunkturprognose für deutsche Wirtschaft',
        'UK economy will grow by less than expected next year', "Pour l'OCDE, la France décroche"],
    mamdaniOther: ['Supermercados públicos con precios', 'Trump y Mamdani mantienen el pragmatismo',
        'receives special Arsenal-based gift'],
    merzOther: ['Rentenkommission drängen Friedrich Merz', 'Los problemas de Merz arrojan dudas',
        'Why Germany’s Leader Merz Is Struggling'],
};
