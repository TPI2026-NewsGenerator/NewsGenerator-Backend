//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: test.feedback.js
//  Description: The thumbs of the reader: examples for the AI and the sources left out
//

import {describe, expect, it} from '@jest/globals';
import {examplesOf, MAX_EXAMPLES, refusedCounts, refusedSources} from '../../services/utils/feedback.js';

const vote = (title, value, feedUrls = []) => ({title, vote: value, feedUrls});

describe('examplesOf', () => {
    it('should give the newest titles liked and refused, at most MAX_EXAMPLES of each', () => {
        const votes = [
            vote('Arbitre sanctionné', 'up'),
            vote('Prediction: A vs B', 'down'),
            ...Array.from({length: MAX_EXAMPLES + 5}, (_, i) => vote(`Old refused ${i}`, 'down')),
        ];
        const {liked, refused} = examplesOf(votes);
        expect(liked).toEqual(['Arbitre sanctionné']);
        expect(refused).toHaveLength(MAX_EXAMPLES);
        expect(refused[0]).toBe('Prediction: A vs B');
    });
});

describe('refusedSources', () => {
    const bets = 'https://bridge/flashscore-bets';
    const tribuna = 'https://rss.tribuna.com/en/feed.xml';
    const shared = 'https://www.lequipe.fr/rss/actu_rss.xml';
    const mine = 'https://my-trusted-feed.org/rss';

    it('should leave out a source found for the profile once its cards were refused 3 times', () => {
        const votes = [
            vote('Bets 1', 'down', [bets, shared]),
            vote('Bets 2', 'down', [bets]),
            vote('Bets 3', 'down', [bets, bets]),       // one card counts once for a source
        ];
        expect(refusedSources(votes, [shared])).toEqual([bets]);
    });

    it('should keep a source refused twice, or liked about as often as refused', () => {
        const votes = [
            vote('A', 'down', [bets]), vote('B', 'down', [bets]),
            vote('C', 'down', [tribuna]), vote('D', 'down', [tribuna]), vote('E', 'down', [tribuna]),
            vote('F', 'up', [tribuna]), vote('G', 'up', [tribuna]),
        ];
        expect(refusedSources(votes, [])).toEqual([]);
    });

    it('should never leave out a shared feed or a feed the reader added by hand', () => {
        const votes = ['A', 'B', 'C', 'D'].map(title => vote(title, 'down', [shared, mine]));
        expect(refusedSources(votes, [shared, mine])).toEqual([]);
    });
});

describe('refusedCounts', () => {
    it('should say how often each source left out was refused and liked, the most refused first', () => {
        const votes = [
            ...['A', 'B', 'C'].map(title => vote(title, 'down', ['https://x/feed'])),
            ...['D', 'E', 'F', 'G'].map(title => vote(title, 'down', ['https://y/feed'])),
            vote('H', 'up', ['https://y/feed']),
        ];
        expect(refusedCounts(votes, [])).toEqual([
            {url: 'https://y/feed', refused: 4, liked: 1},
            {url: 'https://x/feed', refused: 3, liked: 0},
        ]);
        expect(refusedCounts(votes, ['https://y/feed'])).toEqual([{url: 'https://x/feed', refused: 3, liked: 0}]);   // kept
    });
});
