//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: html-to-md.mjs
//  Description: The Markdown of a page of docs written from its HTML, so both always say the same thing:
//               the scripts of the page are run first (its funnel, its tables), then each part of the
//               page is written as Markdown. Run from server/ after changing a page:
//                 node "docs/a-to-z/html-to-md.mjs" "docs/a-to-z/parcours-newsgenerator.html"
//

import {readFileSync, writeFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';

const path = process.argv[2];
if (!path?.endsWith('.html')) throw new Error('A page of docs: node "docs/a-to-z/html-to-md.mjs" "docs/a-to-z/<page>.html"');
const {document} = parseHTML(readFileSync(path, 'utf8'));

// the scripts of the page fill its tables and its funnel; its drawings on a canvas are left out
const noCanvas = new Proxy({}, {get: () => () => {}});
for (const canvas of document.querySelectorAll('canvas')) canvas.getContext = () => noCanvas;
for (const script of document.querySelectorAll('script')) {
    new Function('document', 'getComputedStyle', 'matchMedia', script.textContent)(
        document, () => ({getPropertyValue: () => ''}), () => ({addEventListener: () => {}}));
}

const clean = (text) => text.replace(/\s+/g, ' ').trim();
const has = (node, name) => node.classList?.contains(name);

// the text of a node, its code, bold and italic kept
const inline = (node) => clean([...node.childNodes].map(child => {
    if (child.nodeType === 3) return child.textContent;
    if (child.nodeType !== 1) return '';
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') return ' ';
    if (tag === 'code') return `\`${child.textContent}\``;
    if (tag === 'b' || tag === 'strong') return `**${inline(child)}**`;
    if (tag === 'em' || (tag === 'i' && child.textContent)) return `*${inline(child)}*`;
    if (tag === 'small') return ` (${inline(child)})`;
    return inline(child);
}).join(''));

const cell = (node) => inline(node).replace(/\|/g, '\\|');
// a column drawn on the page only (its bars) has no text: left out
const table = (head, rows) => {
    const kept = head.map((_, i) => i).filter(i => rows.some(row => row[i]));
    const pick = (row) => kept.map(i => row[i] ?? '');
    return [`| ${pick(head).join(' | ')} |`, `|${kept.map(() => '---').join('|')}|`,
        ...rows.map(row => `| ${pick(row).join(' | ')} |`)].join('\n');
};

// a drawing: its boxes in order (title, what it does, its figure), the free labels after
const drawing = (svg) => {
    const rects = [...svg.querySelectorAll('rect')].map(rect => ({
        x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')),
        w: Number(rect.getAttribute('width')), h: Number(rect.getAttribute('height')),
        box: rect.hasAttribute('stroke'),
    }));
    const texts = [...svg.querySelectorAll('text')].map(text => ({
        x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')), text: clean(text.textContent),
        mono: /Mono/.test(text.getAttribute('font-family') ?? ''), title: /Fraunces/.test(text.getAttribute('font-family') ?? ''),
    }));
    const inside = (t, r) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h;
    const boxes = rects.filter(r => r.box && r.w < 400);
    const lanes = rects.filter(r => !r.box && r.w >= 400);
    const used = new Set();
    const boxText = (box) => {
        const own = texts.filter(t => inside(t, box));
        own.forEach(t => used.add(t));
        const number = own.find(t => t.mono && /^\d+$/.test(t.text));
        const title = own.find(t => t.title);
        const plain = own.filter(t => !t.mono && !t.title).map(t => t.text).join(' ');
        const figures = own.filter(t => t.mono && t !== number).map(t => t.text).join(', ');
        return `${number ? `${number.text} · ` : ''}${title?.text ?? ''}${plain ? ` (${plain}` : ''}${figures ? `${plain ? ' ; ' : ' ('}${figures}` : ''}${plain || figures ? ')' : ''}`;
    };
    const lines = lanes.map(lane => {
        const own = boxes.filter(box => box.x >= lane.x && box.x + box.w <= lane.x + lane.w && box.y >= lane.y && box.y + box.h <= lane.y + lane.h)
            .sort((a, b) => a.y - b.y || a.x - b.x);
        const heads = texts.filter(t => inside(t, lane) && !own.some(box => inside(t, box)) && t.x < lane.x + 120);
        heads.forEach(t => used.add(t));
        const [label, ...about] = heads.map(t => t.text);
        // a small box under the chain is beside it, not a step of it
        const side = own.filter(box => box.h < 50).map(box => texts.filter(t => inside(t, box)).map(t => (used.add(t), t.text)).join(' '));
        const chain = own.filter(box => box.h >= 50).map(boxText).join(' → ');
        return `- **${label}**${about.length ? ` (${about.join(' ')})` : ''} : ${chain}${side.length ? ` ; à côté : ${side.join(', ')}` : ''}`;
    });
    const free = texts.filter(t => !used.has(t)).map(t => t.text);
    return [...lines, ...free.map(text => `- ${text}`)].join('\n');
};

const figures = (aside) => {
    const label = clean(aside.querySelector('.label')?.textContent ?? 'Chiffres');
    const items = [...aside.querySelectorAll('dl > div')].map(item => {
        const dd = item.querySelector('dd');
        const small = dd.querySelector('small');
        const main = clean([...dd.childNodes].filter(child => child !== small).map(child => child.nodeType === 1 ? inline(child) : child.textContent).join(''));
        return `${inline(item.querySelector('dt'))} : ${main}${small ? ` (${inline(small)})` : ''}`;
    });
    return `*${label} :* ${items.join(' · ')}`;
};

// one block of the page as Markdown, '' for what it does not need
const block = (node) => {
    if (node.nodeType !== 1) return clean(node.textContent ?? '') ? clean(node.textContent) : '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'canvas', 'defs'].includes(tag)) return '';
    if (tag === 'h1') return `# ${inline(node)}`;
    if (tag === 'h2') return `## ${inline(node)}`;
    if (tag === 'h3') return `### ${inline(node)}`;
    if (tag === 'ul' || tag === 'ol') return [...node.children].map((li, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li)}`).join('\n');
    if (tag === 'table') {
        const head = [...node.querySelectorAll('thead th')].map(cell);
        return table(head, [...node.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(cell)));
    }
    if (tag === 'svg') return drawing(node);
    if (tag === 'aside' && has(node, 'figures')) return figures(node);
    if (has(node, 'meta')) return [...node.children].map(inline).join(' · ');
    if (has(node, 'chips')) return `*Technologies :* ${[...node.children].map(inline).join(' · ')}`;
    // the legend of a drawing on a canvas, which the Markdown has not
    if (has(node, 'legend') && node.previousElementSibling?.tagName === 'CANVAS') return '';
    if (has(node, 'legend')) return [...node.children].map(child => `- ${inline(child)}`).join('\n');
    if (has(node, 'kicker') || has(node, 'label')) return inline(node);
    if (has(node, 'sub')) return `**${inline(node)}**`;
    if (has(node, 'since')) return `> ${inline(node)}`;
    if (has(node, 'quote')) return [...node.children].map(child => `> ${inline(child)}`).join('\n>\n');
    if (has(node, 'tokens')) return `\`\`\`\n${[...node.children].map(span => span.textContent).join(' | ')}\n\`\`\``;
    if (has(node, 'prompt')) return `\`\`\`\n${node.textContent.trim()}\n\`\`\``;
    if (has(node, 'weights')) {
        const names = [...node.querySelectorAll('.w')].map(cell);
        const values = [...node.querySelectorAll('.v')].map(cell);
        return `${table(['Jeton', 'Poids'], names.map((name, i) => [name, values[i]]))}\n\n${inline(node.querySelector('.rest') ?? node)}`;
    }
    if (has(node, 'ladder')) return table(['Étape', 'Nombre', 'La nouvelle'], [...node.querySelectorAll('.step')].map(step =>
        [cell(step.querySelector('.what')), cell(step.querySelector('.count')), step.querySelector('.pos') ? cell(step.querySelector('.pos')).replace(/^la nouvelle : /, '') : '']));
    if (has(node, 'timeline')) return table(['Quand', 'Quoi', 'Délai'], [...node.children].map(row =>
        [cell(row.querySelector('.when')), cell(row.querySelector('.what')), row.querySelector('.gap') ? cell(row.querySelector('.gap')) : '']));
    if (has(node, 'funnel')) return [...node.querySelectorAll('.group')].map(group => [
        `### ${inline(group.querySelector('h3'))} (${inline(group.querySelector('.kicker'))})`,
        table(['Étape', 'Nombre', 'Retiré, pourquoi'], [...group.querySelectorAll('.row')].map(row =>
            [cell(row.querySelector('.what')), cell(row.querySelector('.count')), row.querySelector('.why') ? cell(row.querySelector('.why')) : ''])),
    ].join('\n\n')).join('\n\n');
    if (has(node, 'card')) return [...node.children].map(child => child.tagName === 'H3' ? `> **${inline(child)}**`
        : has(child, 'facts') ? [...child.children].map(fact => `> - ${inline(fact)}`).join('\n')
            : has(child, 'gap') ? '> […]' : has(child, 'why') ? `> *Pourquoi pour vous :* ${inline(child)}` : `> ${inline(child)}`).join('\n>\n');
    if (has(node, 'station')) {
        const no = inline(node.querySelector('.no'));
        const body = node.querySelector('.body');
        const [title, ...rest] = [...body.children];
        return [`### ${no} · ${inline(title)}`, ...rest.map(block), ...[...node.querySelectorAll(':scope > aside')].map(block)].filter(Boolean).join('\n\n');
    }
    if (has(node, 'part-head') || has(node, 'section-head')) {
        const kicker = node.querySelector('.kicker, .label');
        const head = node.querySelector('h2');
        const title = kicker && head ? `## ${inline(kicker)} : ${inline(head).replace(/^./, c => c.toLowerCase())}` : head ? `## ${inline(head)}` : '';
        return [title, ...[...node.children].filter(child => child !== kicker && child !== head).map(block)].filter(Boolean).join('\n\n');
    }
    if (has(node, 'machine')) {
        const [kicker, head, ...rest] = [...node.children];
        return [`### ${inline(kicker)} — ${inline(head)}`, ...rest.map(block)].join('\n\n');
    }
    if (tag === 'p' || tag === 'span' || tag === 'dd' || tag === 'dt') return inline(node);
    if (tag === 'footer') return ['---', ...[...node.children].map(block)].join('\n\n');
    if (has(node, 'notes')) return [...node.children].map(note => [...note.children].map(block).join('\n\n')).join('\n\n');
    // a box of other blocks
    return [...node.childNodes].map(block).filter(Boolean).join('\n\n');
};

const page = document.querySelector('.page') ?? document.body;
const markdown = block(page).replace(/\n{3,}/g, '\n\n').trim() + '\n';
writeFileSync(path.replace(/\.html$/, '.md'), markdown);
console.log(`${path.replace(/\.html$/, '.md')}: ${markdown.length} characters`);
