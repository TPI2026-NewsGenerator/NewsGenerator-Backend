//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: run.mjs
//  Description: Runs MkDocs for the documentation site (mkdocs.yml) from its own venv, made the first time:
//                 pnpm run docs          the site on http://127.0.0.1:8000, rebuilt at each change
//                 pnpm run docs:build    site/, failing on a broken link or a wrong version in tools.md
//               The same on Windows and on Linux: python is "python" or "python3", the venv's in
//               Scripts/ or bin/
//

import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const SERVER = path.resolve(import.meta.dirname, '..');
const VENV = path.join(SERVER, '.venv-docs');
const venvPython = process.platform === 'win32'
    ? path.join(VENV, 'Scripts', 'python.exe')
    : path.join(VENV, 'bin', 'python');

const run = (command, args) => {
    const result = spawnSync(command, args, {cwd: SERVER, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!existsSync(venvPython)) {
    const python = spawnSync('python', ['--version']).status === 0 ? 'python' : 'python3';
    console.log(`First run: the venv of the docs in ${VENV}`);
    run(python, ['-m', 'venv', VENV]);
    run(venvPython, ['-m', 'pip', 'install', '-q', '-r', path.join('docs-site', 'requirements.txt')]);
}

const [command = 'serve', ...rest] = process.argv.slice(2);
run(venvPython, ['-m', 'mkdocs', command, ...(command === 'build' ? ['--strict'] : []), ...rest]);
