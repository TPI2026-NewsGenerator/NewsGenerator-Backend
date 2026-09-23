//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: grouping.js
//  Description: Building the groups of articles telling the same news, from the similarity of
//               their titles. Pure: it is given the pairs and answers which group each article
//               belongs to.
//

"use strict"

// Every article of a group points to the first article of that group. A and B, then B and C, puts
// A and C together: right for identical texts, where being the same copy really does carry over,
// and wrong for news, where it chains (see averageLink).
export const unionFind = (articles, pairs) => {
    const groupOf = new Map(articles.map(article => [article.id, article.id]));
    const find = (id) => {
        while (groupOf.get(id) !== id) id = groupOf.get(id);
        return id;
    };

    for (let {id_a, id_b} of pairs) {
        const [a, b] = [find(id_a), find(id_b)];
        if (a !== b) groupOf.set(b, a);
    }

    return find;
};

// An article joins the group it resembles ON AVERAGE, not the one where it found a single link.
//
// Grouping on single links chains: A and B tell the same news, B and C too, so A and C end up
// together whatever they have to do with each other. Measured on 500 articles in each of four
// languages, that is what grew the twenty-five article card on the UN General Assembly, and the
// average is what stops it: of forty groups read and judged by hand, single links recover 34 and
// leave a largest group of 27 articles in French, the average recovers 39 and never exceeds 9.
//
// The pairs that are missing are the pairs the database left under the threshold, and they count
// as no resemblance at all. Measured both ways, that changes nothing, so the query is left as it is.
//
// The articles are expected in the order they are shown, the most recent first: a group is then
// led by the freshest telling of its news.
export const averageLink = (articles, pairs, threshold) => {
    const scores = new Map();
    for (let {id_a, id_b, score} of pairs) scores.set(`${id_a}:${id_b}`, Number(score));
    const between = (a, b) => scores.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0;

    const groups = [];
    for (let article of articles) {
        let best = null;
        let bestScore = threshold;

        for (let group of groups) {
            const mean = group.reduce((sum, other) => sum + between(article.id, other), 0) / group.length;
            if (mean >= bestScore) {
                best = group;
                bestScore = mean;
            }
        }

        if (best) best.push(article.id);
        else groups.push([article.id]);
    }

    const groupOf = new Map();
    for (let group of groups) for (let id of group) groupOf.set(id, group[0]);
    return (id) => groupOf.get(id);
};
