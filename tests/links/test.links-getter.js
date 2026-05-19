//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: test.links-getter.js
//  Description: Tests for custom getting links
//

import Links from "../../services/utils/links.js";
import data from '../data/data.json'

test('get one category link', () => {
    // Given
    const category = ["world"];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(data.result1);
});

test('get multiple category links', () => {
    // Given
    const category = ["world", "press", "sport"];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(data.result2);
});

test('get non-existent category links', () => {
    // Given
    const category = ["technology"];

    // When & Then
    expect(() => Links.getCategoriesLinks(category)).toThrow(data.result3);
});

test('get existent and non-existent category links', () => {
    // Given
    const category = ["technology", "world"];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(data.result1);
});

test('get category links without keywords', () => {
    // Given
    const category = [];

    // When & Then
    expect(() => Links.getCategoriesLinks(category)).toThrow(data.result4);
});