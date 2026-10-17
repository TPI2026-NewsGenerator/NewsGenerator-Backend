#
#  Author: Fabian Rostello
#  Date: 17.10.2026
#  File: hooks.py
#  Description: The hooks of the documentation site (mkdocs.yml). The docs stay plain Markdown that reads
#               the same on GitHub; the site adds three things at build:
#               - the docs of the client (../client/docs, its own repo) under client/, its links and the
#                 server's links to it pointed to their place in the site;
#               - the diagrams linked as .png shown in the page, zoomable (not in diagrams.md, which
#                 lists them all);
#               - the versions of docs/tools.md checked against node_modules: a version this page gives
#                 that is not the one installed fails the build (mkdocs build --strict)
#

import json
import logging
import os
import re
from urllib.parse import quote, unquote

from mkdocs.structure.files import File

log = logging.getLogger('mkdocs.hooks.newsgenerator')

SERVER = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
CLIENT = os.path.normpath(os.path.join(SERVER, '..', 'client'))
SERVER_DOCS = os.path.join(SERVER, 'docs')
CLIENT_DOCS = os.path.join(CLIENT, 'docs')
CLIENT_PREFIX = 'client'
# every diagram in one page (written by docs-site/diagrams.mjs): its diagrams stay links
DIAGRAMS_PAGE = 'diagrams.md'

# [text](target) and ![text](target), the target in <...> when it holds spaces
LINK = re.compile(r'(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)')


def original_page(abs_path):
    """A page of the docs written in HTML whose Markdown is made from it (a-to-z/parcours-*.html, see
    html-to-md.mjs): the site shows the Markdown at its name, the HTML as original/<name>.html."""
    return abs_path.lower().endswith('.html') and os.path.isfile(abs_path[:-5] + '.md')


def original_uri(uri):
    """Where the HTML original of a page is in the site: original/ next to its Markdown."""
    folder, name = os.path.split(uri)
    return '/'.join(part for part in (folder, 'original', name) if part)


def on_files(files, config):
    """The HTML originals of the pages under their own name (mkdocs.yml excludes them at theirs, the
    Markdown page has it), and the docs of the client under client/ of the site, when its repo is next
    to this one."""
    for folder, _, names in os.walk(SERVER_DOCS):
        for name in names:
            path = os.path.join(folder, name)
            if original_page(path):
                uri = original_uri(os.path.relpath(path, SERVER_DOCS).replace(os.sep, '/'))
                files.append(File.generated(config, uri, abs_src_path=path))
    if not os.path.isdir(CLIENT_DOCS):
        log.info('No client docs at %s: the site has the server docs only', CLIENT_DOCS)
        return files
    for folder, _, names in os.walk(CLIENT_DOCS):
        for name in names:
            path = os.path.join(folder, name)
            uri = CLIENT_PREFIX + '/' + os.path.relpath(path, CLIENT_DOCS).replace(os.sep, '/')
            files.append(File.generated(config, uri, abs_src_path=path))
    return files


def site_uri(abs_path):
    """The path in the site of a file of either docs folder, None for any other."""
    abs_path = os.path.normpath(abs_path)
    for root, prefix in ((SERVER_DOCS, ''), (CLIENT_DOCS, CLIENT_PREFIX + '/')):
        if abs_path == root or abs_path.startswith(root + os.sep):
            return prefix + os.path.relpath(abs_path, root).replace(os.sep, '/')
    return None


def on_page_markdown(markdown, page, config, files):
    source = page.file.abs_src_path
    page_dir = os.path.dirname(page.file.src_uri)

    def rewrite(match):
        bang, text, target = match.groups()
        bare = target[1:-1] if target.startswith('<') else target
        if re.match(r'^[a-z][a-z0-9+.-]*:', bare) or bare.startswith('#'):
            return match.group(0)
        path, _, anchor = bare.partition('#')
        if not path:
            return match.group(0)
        absolute = os.path.join(os.path.dirname(source), unquote(path))
        # a folder linked (GitHub lists its files) is its README in the site, when it has one
        if os.path.isdir(absolute) and os.path.isfile(os.path.join(absolute, 'README.md')):
            absolute = os.path.join(absolute, 'README.md')
        uri = site_uri(absolute)
        if uri is not None and original_page(absolute):
            uri = original_uri(uri)
        if uri is not None:
            relative = os.path.relpath(uri, page_dir or '.').replace(os.sep, '/')
            path = quote(relative)
        # a diagram linked is shown, zoomable; the index of the diagrams lists them, each opened on its own
        if not bang and path.lower().endswith('.png') and page.file.src_uri != DIAGRAMS_PAGE:
            bang = '!'
        return f'{bang}[{text}]({path}{"#" + anchor if anchor else ""})'

    markdown = LINK.sub(rewrite, markdown)
    if page.file.src_uri == 'tools.md':
        check_versions(markdown)
    return markdown


def installed(repo, package):
    """The version of an npm package installed in a repo, else the one its package.json asks, else None."""
    try:
        with open(os.path.join(repo, 'node_modules', package, 'package.json'), encoding='utf-8') as f:
            return json.load(f)['version']
    except OSError:
        pass
    with open(os.path.join(repo, 'package.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    wanted = {**manifest.get('dependencies', {}), **manifest.get('devDependencies', {})}.get(package)
    return wanted.lstrip('^~') if wanted else None


def check_versions(markdown):
    """Each row of tools.md naming an npm package (`package`) must give the version installed: the one of
    the client in its section, the server's elsewhere."""
    repo, columns = SERVER, None
    for line in markdown.splitlines():
        if line.startswith('## '):
            repo = CLIENT if line.strip() == '## Client' else SERVER
            continue
        if not line.startswith('|'):
            columns = None
            continue
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if columns is None:
            # the header of a table: the rows are read by its columns
            columns = cells
            continue
        if 'Package' not in columns or 'Version' not in columns or set(''.join(cells)) <= set('-: '):
            continue
        match = re.fullmatch(r'`([@a-z0-9./_-]+)`', cells[columns.index('Package')])
        if not match:
            continue
        package, version = match.group(1), cells[columns.index('Version')]
        target = repo
        if installed(target, package) is None and installed(CLIENT if target == SERVER else SERVER, package):
            target = CLIENT if target == SERVER else SERVER
        actual = installed(target, package)
        if actual is None:
            log.warning('tools.md: %s is in no package.json', package)
        elif version != actual:
            log.warning('tools.md: %s is %s in %s, the page says %s', package, actual, os.path.basename(target), version)
