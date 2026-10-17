//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: diagrams.mjs
//  Description: Writes docs/diagrams.md, every diagram of the docs in one page: the whole system, then
//               the class and sequence diagrams of each feature in the order of the site (mkdocs.yml),
//               the client's, and the archive. The diagrams stay next to the text of their feature; this
//               page only lists them. Run by run.mjs before the site is served or built, or from server/:
//                 node docs-site/diagrams.mjs
//

import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, '..');
const SERVER_DOCS = path.join(SERVER, 'docs');
const CLIENT_DOCS = path.resolve(SERVER, '..', 'client', 'docs');
const OUT = path.join(SERVER_DOCS, 'diagrams.md');
// the folders of the whole system, before the features
const SYSTEM = ['a-to-z', 'database'];

// [relative path] of the files of a folder and its subfolders, _style left out (the style of the diagrams)
const filesOf = (root, dir = '') => readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return entry.name === '_style' ? [] : filesOf(root, relative);
    return [relative];
}).sort();

// {folder, name, link, title, kind} of each .puml of a docs folder; link: its .png when rendered, else its source
const diagramsOf = (root, prefix) => filesOf(root).filter(file => file.endsWith('.puml')).map(file => {
    const source = readFileSync(path.join(root, file), 'utf8');
    const png = file.replace(/\.puml$/, '.png');
    const title = source.match(/^\s*title\s+(.+)$/m)?.[1].trim() ?? '';
    // the diagrams of the current docs include the style of their kind, the older ones do not
    const kind = source.includes('_style/class.iuml') ? 'class'
        : source.includes('_style/sequence.iuml') ? 'sequence' : 'other';
    return {
        folder: path.posix.dirname(file),
        name: path.posix.basename(file, '.puml'),
        link: prefix + (existsSync(path.join(root, png)) ? png : file),
        title, kind,
    };
});

// the pages of the site in their order, with their name: [{folder, label}], "Briefing > Denials" for a
// part of a feature (the groups between them, "How a card reads", left out)
const navFolders = () => {
    const nav = readFileSync(path.join(SERVER, 'mkdocs.yml'), 'utf8').split(/^nav:\s*$/m)[1] ?? '';
    const sections = [];
    const pages = [];
    for (const line of nav.split('\n')) {
        const item = line.match(/^(\s*)- (?:([^:]+):\s*)?(\S+\.md)?\s*$/);
        if (!item) continue;
        const [, indent, label, page] = item;
        // the items of nav: are indented once
        const depth = indent.length / 2 - 1;
        if (!page) {
            sections[depth] = label;
            sections.length = depth + 1;
            continue;
        }
        if (!page.endsWith('README.md')) continue;
        const top = depth > 0 ? sections[0] : label;
        pages.push({folder: path.posix.dirname(page), label: label && depth > 0 ? `${top} > ${label}` : top});
    }
    return pages;
};

const cell = (text) => text.replace(/\|/g, '\\|');
const links = (diagrams) => diagrams.map(diagram => `[${diagram.name}](${diagram.link})`).join('<br>') || '·';

// a table of the features of a docs folder: its class, sequence and other diagrams, the page of each
const featureTable = (rows) => [
    '| Feature | Class | Sequence | Other |',
    '|---|---|---|---|',
    ...rows.map(({label, page, diagrams}) => `| ${page ? `[${label}](${page})` : label} | `
        + ['class', 'sequence', 'other'].map(kind => links(diagrams.filter(diagram => diagram.kind === kind))).join(' | ') + ' |'),
];

const server = diagramsOf(SERVER_DOCS, '').filter(diagram => !diagram.folder.startsWith('archive'));
const byFolder = Map.groupBy(server, diagram => diagram.folder);
const serverRows = navFolders().filter(({folder}) => byFolder.has(folder) && !SYSTEM.includes(folder))
    .map(({folder, label}) => ({label, page: `${folder}/README.md`, diagrams: byFolder.get(folder)}));
const listed = new Set([...SYSTEM, ...serverRows.map(row => row.diagrams[0].folder)]);
const unlisted = [...byFolder.keys()].filter(folder => !listed.has(folder));
if (unlisted.length > 0) console.warn(`diagrams.mjs: folders with diagrams but no page in mkdocs.yml: ${unlisted.join(', ')}`);

// the client's docs are in its own repo, next to this one
const hasClient = existsSync(CLIENT_DOCS);
const CLIENT_LINK = '../../client/docs/';
const client = hasClient ? diagramsOf(CLIENT_DOCS, CLIENT_LINK).filter(diagram => !diagram.folder.startsWith('archive')) : [];
const titleOf = (folder) => folder.split('/').map(part => part[0].toUpperCase() + part.slice(1).replace(/-/g, ' ')).join(' > ');
const clientRows = [...Map.groupBy(client, diagram => diagram.folder)].map(([folder, diagrams]) => ({
    label: titleOf(folder),
    page: existsSync(path.join(CLIENT_DOCS, folder, 'README.md')) ? `${CLIENT_LINK}${folder}/README.md` : null,
    diagrams,
}));

// the archive keeps images of the first sprints without their source
const archiveOf = (root, prefix) => existsSync(path.join(root, 'archive'))
    ? filesOf(root, 'archive').filter(file => file.endsWith('.png') || file.endsWith('.puml') && !existsSync(path.join(root, file.replace(/\.puml$/, '.png'))))
        .map(file => `[${path.posix.basename(file).replace(/\.(png|puml)$/, '')}](${prefix}${file})`)
    : [];

const lines = [
    '# Diagrams',
    '',
    '<!-- Written by docs-site/diagrams.mjs (run.mjs runs it before the site): change the diagrams, not this page. -->',
    '',
    'Every diagram of the docs in one place. Each one stays in the folder of its feature, next to the text that',
    'explains it (its `.puml` source has the same name as its `.png`): this page only lists them, to find one',
    'without knowing its feature, or to read all the diagrams of one kind.',
    '',
    '## The whole system',
    '',
    '| Diagram | What it shows |',
    '|---|---|',
    ...server.filter(diagram => SYSTEM.includes(diagram.folder))
        .map(diagram => `| [${diagram.name}](${diagram.link}) | ${cell(diagram.title)} |`),
    '',
    '## The features',
    '',
    'A class diagram (what each part holds and calls) and a sequence diagram (one use, step by step) for',
    'each feature and each of its parts. Other: the diagrams of the first sprints, kept where they were.',
    '',
    ...featureTable(serverRows),
    '',
];
if (hasClient) {
    lines.push('## The client', '', 'The pages and components of the client, by feature, and its use cases.', '', ...featureTable(clientRows), '');
}
lines.push('## Archive', '',
    'The MCD, MLD, class and use case diagrams of sprints 1 to 3, kept as they were.', '',
    ...[...archiveOf(SERVER_DOCS, ''), ...(hasClient ? archiveOf(CLIENT_DOCS, CLIENT_LINK) : [])].map(link => `- ${link}`), '');

writeFileSync(OUT, lines.join('\n'));
console.log(`${path.relative(SERVER, OUT)}: ${server.length + client.length} diagrams`);
