import {Filter} from '../../services/utils/filter.js'

describe('Filter.SearchApi', () => {
    const mockNewsList = [
        {
            title: 'Le climat se réchauffe',
            category: 'Environnement'
        },
        {
            title: 'Nouveau record au 100m',
            category: ['Sport', 'Athlétisme']
        },
        {
            title: 'La tech en 2024',
            category: { "#text": "Technologie" }
        }
    ];

    it('should return empty array if keywords are empty', () => {
        const result = Filter.News(mockNewsList, ['']);
        expect(result).toEqual([]);
    });

    it('should filter by title', () => {
        const result = Filter.News(mockNewsList, ['climat']);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Le climat se réchauffe');
    });

    it('should filter by category (string)', () => {
        const result = Filter.News(mockNewsList, ['Environnement']);
        expect(result).toHaveLength(1);
    });

    it('should filter by category (array)', () => {
        const result = Filter.News(mockNewsList, ['Sport']);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Nouveau record au 100m');
    });

    it('should filter by category (object with #text)', () => {
        const result = Filter.News(mockNewsList, ['Technologie']);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('La tech en 2024');
    });

    it('should be case insensitive', () => {
        const result = Filter.News(mockNewsList, ['CLIMAT']);
        expect(result).toHaveLength(1);
    });
});