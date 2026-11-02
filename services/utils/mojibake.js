//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: mojibake.js
//  Description: The text of a feed that was written in UTF-8, read as ISO-8859-1 or Windows-1252 and written in
//               UTF-8 again by the site ("Ghana" + the three characters of an apostrophe's bytes + "s" for
//               "Ghana's", "Ã©" for "é"), put back as it was
//

"use strict"

// What Windows-1252 puts at 0x80-0x9F, as the characters it shows: the bytes of a UTF-8 character read so
// are these characters, where ISO-8859-1 gives the control characters U+0080-U+009F
const WINDOWS_1252 = new Map(Object.entries({
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
}).map(([code, byte]) => [Number(code), byte]));

const byteOf = (char) => {
    const code = char.codePointAt(0);
    return code < 256 ? code : WINDOWS_1252.get(code) ?? null;
};

// A first byte of UTF-8 as the character it shows (U+00C2-U+00C5, U+00E2, U+00F0), and the 1 to 3 bytes
// after it as theirs (U+0080-U+00BF, or what Windows-1252 shows at 0x80-0x9F). Only the first bytes of what a
// feed really holds: the accented letters of Latin (2 bytes), the punctuation, symbols and euro (E2:
// ’ “ ” – … € ™ ★) and the emoji (F0). Any other would take real text for broken: "nécessité »" (a no-break
// space before the guillemet) is the three bytes of "頻"
const CONTINUATION = String.raw`[\u0080-¿${[...WINDOWS_1252.keys()].map(code => String.fromCodePoint(code)).join('')}]`;
const MOJIBAKE = new RegExp(String.raw`[Â-Åâð]${CONTINUATION}{1,3}`, 'g');
const utf8 = new TextDecoder('utf-8', {fatal: true});

// what a run may be once read again: one character of the ranges a feed holds, never a rare letter ("É" and
// a no-break space are the bytes of "ɠ") nor a control character
const PLAUSIBLE = [[0x00A0, 0x017F], [0x2000, 0x206F], [0x20A0, 0x20CF], [0x2100, 0x214F], [0x2190, 0x21FF], [0x2600, 0x27BF], [0x1F000, 0x1FAFF]];
const isPlausible = (char) => PLAUSIBLE.some(([from, to]) => char.codePointAt(0) >= from && char.codePointAt(0) <= to);

// the characters of a run read again as UTF-8, null when their bytes are no plausible character
const decoded = (chars) => {
    const bytes = chars.map(byteOf);
    if (bytes.includes(null)) return null;
    try {
        const char = utf8.decode(Uint8Array.from(bytes));
        // "Å" and a no-break space (a Swedish word in capitals before a mark) are the bytes of "Š"
        if (chars[1] === ' ' && char.codePointAt(0) >= 0x100) return null;
        return isPlausible(char) ? char : null;
    } catch {
        return null;
    }
};

// The text with each run of such characters read again as the UTF-8 bytes they are, the longest start of
// the run that is one ("Ã©¿" is "é" and the "¿" after it), left as it is when none is. Text that was never
// broken has none: it comes back as it was
export const repairMojibake = (text) => {
    if (typeof text !== 'string') return text;
    return text.replace(MOJIBAKE, (run) => {
        const chars = [...run];
        for (let length = chars.length; length >= 2; length--) {
            const repaired = decoded(chars.slice(0, length));
            if (repaired !== null) return repaired + chars.slice(length).join('');
        }
        return run;
    });
};
