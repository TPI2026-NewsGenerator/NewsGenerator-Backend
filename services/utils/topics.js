//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: topics.js
//  Description: Topics given by the AI to the news
//

"use strict"

// the AI must choose one of these topics for each news, 'other' when none fits
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

// check the desired and undesired topics of a search, returns an error message or null if valid
// both are optional (undefined = no filter)
export const topicsError = (topics, undesiredTopics) => {
    if (topics !== undefined && (!Array.isArray(topics) || !topics.every(isTopic))) {
        return `Topics must be an array of: ${TOPICS.join(', ')}.`;
    }
    if (undesiredTopics !== undefined && (!Array.isArray(undesiredTopics) || !undesiredTopics.every(isTopic))) {
        return `Undesired topics must be an array of: ${TOPICS.join(', ')}.`;
    }

    const bothTopics = (topics ?? []).filter(topic => (undesiredTopics ?? []).includes(topic));
    if (bothTopics.length > 0) {
        return `A topic can't be desired and undesired: ${bothTopics.join(', ')}.`;
    }

    return null;
};
