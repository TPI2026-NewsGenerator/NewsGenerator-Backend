//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.projects.js
//  Description: The projects of a profile: written with the AI's questions on the project only, split
//               into interests as a profile is, saved with their last day, and given to the AI of the
//               briefing with the profile while they run
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const ProfileModel = {
    owned: jest.fn(async () => ({id: 3, id_user: 4, name: 'Roberto', text: 'Je suis l’arbitrage du football suisse.', languages: ['fr']})),
    projects: jest.fn(async () => []),
    projectInterests: jest.fn(async () => []),
    addProject: jest.fn(async () => 1),
    deleteProject: jest.fn(async () => 1),
    setProjectEnd: jest.fn(async () => 1),
};
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel}));
const interestsOf = jest.fn(async () => ({interests: [{text: 'Les grèves des trains au Japon', weight: 1, keywords: '', searches: [], sections: [], category: 'world'}], refused: []}));
const profileAi = await import('../../services/utils/profile-ai.js');
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({...profileAi, interestsOf}));
const embedder = await import('../../services/utils/embedder.js');
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({...embedder,
    embed: jest.fn(async (texts) => texts.map(() => ({dense: [0.1], sparse: {1: 0.5}}))),
    toVector: (dense) => `[${dense}]`, toSparsevec: () => '{1:0.5}/250002',
}));
const {ProfileService} = await import('../../services/profile-service.js');
const {projectQuestionsPrompt} = await import('../../services/utils/profile-funnel.js');
const {readerText} = await import('../../services/briefing-service.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
// the page shown once saved: only the call matters here
ProfileService.get = jest.fn(async () => ({saved: true}));
const inDays = (days) => new Date(Date.now() + days * 24 * 3600e3).toISOString().slice(0, 10);

beforeEach(() => {
    chat.mockReset();
    Object.values(ProfileModel).forEach(fn => fn.mockClear());
    interestsOf.mockClear();
});

describe('ProfileService.createProject', () => {
    it('should split the description into interests with their vectors and save it with its last day', async () => {
        const text = 'Je pars au Japon en novembre et je veux savoir les grèves et la météo.';
        await ProfileService.createProject(4, 3, {name: '  Voyage   au Japon ', text, endsOn: inDays(30)});

        expect(interestsOf).toHaveBeenCalledWith(expect.objectContaining({text, language: 'fr'}));
        const [userId, profileId, project, interests] = ProfileModel.addProject.mock.calls[0];
        expect([userId, profileId]).toEqual([4, 3]);
        expect(project).toEqual({name: 'Voyage au Japon', text, endsOn: inDays(30)});
        expect(interests[0]).toMatchObject({text: 'Les grèves des trains au Japon', dense: '[0.1]', sparse: '{1:0.5}/250002'});
    });

    it('should refuse a project with no name, too short a text, a last day passed or too far, or a sixth one', async () => {
        const text = 'Je pars au Japon en novembre et je veux savoir les grèves.';
        for (const asked of [{name: '', text}, {name: 'Japon', text: 'Japon'}, {name: 'Japon', text, endsOn: inDays(-2)},
            {name: 'Japon', text, endsOn: inDays(400)}, {name: 'Japon', text, endsOn: '2026-02-31'}, {name: 'Japon', text, endsOn: 'soon'}]) {
            await expect(ProfileService.createProject(4, 3, asked)).rejects.toMatchObject({status: 400});
        }
        ProfileModel.projects.mockResolvedValueOnce([1, 2, 3, 4, 5].map(id => ({id})));
        await expect(ProfileService.createProject(4, 3, {name: 'Japon', text})).rejects.toMatchObject({status: 400});
        expect(interestsOf).not.toHaveBeenCalled();
        expect(ProfileModel.addProject).not.toHaveBeenCalled();
    });

    it('should refuse a description where the AI reads no subject', async () => {
        interestsOf.mockResolvedValueOnce({interests: [], refused: []});
        await expect(ProfileService.createProject(4, 3, {name: 'Rien', text: 'Je ne sais pas encore vraiment quoi.'})).rejects.toMatchObject({status: 422});
    });

    it('should never touch a project of another profile', async () => {
        ProfileModel.owned.mockResolvedValueOnce(null);
        await expect(ProfileService.removeProject(4, 9, 1)).rejects.toMatchObject({status: 404});
        ProfileModel.deleteProject.mockResolvedValueOnce(0);
        await expect(ProfileService.removeProject(4, 3, 99)).rejects.toMatchObject({status: 404});
        await ProfileService.setProjectEnd(4, 3, 1, null);
        expect(ProfileModel.setProjectEnd).toHaveBeenCalledWith(3, 1, null);
    });
});

describe('ProfileService.projectQuestions', () => {
    it('should ask the AI about the project only, in the language of the profile, its text given', async () => {
        chat.mockResolvedValueOnce(json({enough: false, questions: [{question: 'Quelles villes ?', options: ['Tokyo', 'Kyoto']}]}));
        const answer = await ProfileService.projectQuestions(4, 3, {start: 'Voyage au Japon', rounds: []});
        expect(answer.questions).toEqual([{question: 'Quelles villes ?', options: ['Tokyo', 'Kyoto']}]);
        const prompt = chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('Je suis l’arbitrage du football suisse.');
        expect(prompt).toContain('Il ajoute un projet');
    });
});

describe('projectQuestionsPrompt', () => {
    it('should not ask how long the project lasts, nor what the profile says already', () => {
        const prompt = projectQuestionsPrompt({start: 'Japon', rounds: [], language: 'fr', profileText: 'Le tennis.'});
        expect(prompt).toContain('Ne demande pas jusqu\'à quand il dure');
        expect(prompt).toContain('ni sur ce que son profil dit déjà');
    });
});

describe('readerText', () => {
    it('should give the AI the profile alone without a project, and each project running in the reader\'s words', () => {
        expect(readerText('Le tennis.')).toBe('Le tennis.');
        const text = readerText('Le tennis.', [{name: 'Japon', text: 'Je pars  au Japon.\nLes grèves.'}]);
        expect(text).toMatch(/^Le tennis\.\n\nEn ce moment, il prépare aussi un projet/);
        expect(text).toContain('- « Japon » : Je pars au Japon. Les grèves.');
    });
});
