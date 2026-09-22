//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: dates.js
//  Description: Dates of the RSS feeds, they don't all use the same format
//

"use strict"

// timezone names JavaScript doesn't know, some feeds use them (Sky Sports: "22 Sep 2026 19:08:00 BST")
const TIMEZONES = {
    BST: '+0100', WET: '+0000', WEST: '+0100', CET: '+0100', CEST: '+0200', EET: '+0200', EEST: '+0300',
    AEST: '+1000', AEDT: '+1100', ACST: '+0930', ACDT: '+1030', AWST: '+0800', NZST: '+1200', NZDT: '+1300',
    JST: '+0900', KST: '+0900', HKT: '+0800', SGT: '+0800', MSK: '+0300',
};

// date of a feed, null when it is missing or unreadable
export const toDate = (value) => {
    if (!value) return null;

    let date = new Date(value);
    if (isNaN(date)) {
        // replace the timezone name by its offset and try again
        const zone = String(value).trim().match(/([A-Z]{2,5})$/)?.[1];
        if (TIMEZONES[zone]) date = new Date(String(value).trim().replace(/[A-Z]{2,5}$/, TIMEZONES[zone]));
    }

    return isNaN(date) ? null : date;
};
