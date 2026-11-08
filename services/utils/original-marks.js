//
//  Author: Fabian Rostello
//  Date: 30.10.2026
//  File: original-marks.js
//  Description: The marks around a sentence the translation left in its own language
//

"use strict"

// A sentence that could not be translated with its figures (see translatePassages of extract.js) stays in
// its own language between parentheses, and a briefing shows it in italics: it is written between these
// two characters of the private use area, which a text for another use takes out
export const ORIGINAL_START = '';
export const ORIGINAL_END = '';
export const withoutOriginalMarks = (text) => text?.replace(/[]/g, '') ?? text;
// The sign after a sentence translated whose figures the check could not match to the original's (a briefing shows it in italics too)
export const UNCHECKED = '⚠';
