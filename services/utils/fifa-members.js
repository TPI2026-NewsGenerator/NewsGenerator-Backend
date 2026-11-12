//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-members.js
//  Description: The 211 member associations and the 6 confederations of FIFA as the map and the readings use them (the file is made by
//               scripts/build-fifa-members.js): one row each, with the country as its name, the association's full name, its
//               code of FIFA, its confederation, its country code, where to draw it and the acronyms the news write
//

"use strict"

import {readFileSync} from 'node:fs';

const FILE = JSON.parse(readFileSync(new URL('./fifa-members.json', import.meta.url), 'utf8'));

export const ASSOCIATIONS = FILE.members.map(member => ({...member, name: member.country, level: 'association', acronyms: member.acronyms ?? []}));
// a confederation has no country: its name is its own, its acronym is its code
export const CONFEDERATIONS = FILE.confederations.map(item => ({
    ...item, association: item.name, level: 'confederation', confederation: item.fifa, country: null, iso: null, lat: null, lng: null, acronyms: [item.fifa],
}));
export const MEMBER_LIST = [...ASSOCIATIONS, ...CONFEDERATIONS];
export const MEMBERS = new Map(MEMBER_LIST.map(member => [member.qid, member]));
export const memberOfFifa = (code) => MEMBER_LIST.find(member => member.fifa === code) ?? null;
