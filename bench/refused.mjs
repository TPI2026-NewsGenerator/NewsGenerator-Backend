// the sources the thumbs of a reader leave out, and their votes as counted
import 'dotenv/config';
import {FeedbackService} from '../services/feedback-service.js';
const userId = Number(process.argv[2]);
console.log(JSON.stringify(await FeedbackService.refusedSources(userId)));
process.exit(0);
