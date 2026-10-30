// which medium stops the fill of the directory: one at a time, each printed before it is tried
import process from 'node:process';
import {DirectoryService} from '../services/directory-service.js';
for (let i = 0; i < 400; i++) {
    const [tried] = await DirectoryService.grow({named: 0, sections: 1, concurrency: 1});
    if (!tried) break;
    console.log(tried.medium, tried.kept.length, tried.reason ?? '');
}
process.exit(0);
