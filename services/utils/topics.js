//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: topics.js
//  Description: Topics the AI can give to a news with its resume
//

"use strict"

// the AI must choose one of these topics for the news it summarizes, 'other' when none fits
export const TOPICS = [
    'politics',
    'economy',
    'conflict',
    'society',
    'technology',
    'science',
    'health',
    'environment',
    'culture',
    'sport',
    'other',
];

export const isTopic = (value) => TOPICS.includes(value);
