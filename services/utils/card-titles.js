//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: card-titles.js
//  Description: The titles of a card given to the AI that reads it (the countries it is about, the check of its names): its own title
//               first, then the titles of its articles. They read the first few only (3 titles): a card that has joined several stories
//               gave them the titles of the oldest story, whatever the title the reader sees (the unsaved briefing of Enzo of
//               8.11.2026: "El mensaje de Emilio García Silvero" had joined the story of Infantino's fourth term, whose titles came
//               first; the AI refused Spain for Silvero 4 times of 4, and kept it 4 of 4 with the title of the card first)
//

"use strict"

// [title] the title of the card, then the titles of its articles (titles), each once, none empty
export const titlesOfCard = (title, titles = []) => [...new Set([title, ...titles].map(one => String(one ?? '').trim()).filter(Boolean))];
