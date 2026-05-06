import { jest } from '@jest/globals';

jest.unstable_mockModule('../../services/login-service.js', () => ({
    LoginService: {
        authUser: jest.fn()
    }
}));

const { LoginController } = await import('../../controllers/login-controller.js');
const { LoginService } = await import('../../services/login-service.js');

describe('authUser', () => {
    // aide IA: how to mock api request and response
    let mockRes;
    let mockReq;

    beforeEach(() => {
        mockRes = {
            status: jest.fn().mockReturnThis(), // permet de chainer .status().json()
            json: jest.fn().mockReturnThis()
        };
    });

    it('should return status 200 with user id + jwt token', async () => {
        // given
        const mockControllerResponse = {id_user: 1, token: 'mock-token'}
        LoginService.authUser.mockResolvedValue(mockControllerResponse);
        mockReq = { body: { username: "joe", password: "strongPass" }}

        // when
        const result = await LoginController.authUser(mockReq, mockRes);

        // then
        expect(result.status).toHaveBeenCalledWith(200);
        expect(result.json).toHaveBeenCalledWith(mockControllerResponse);
    });

    it('should return status 404 if service has no username', async () => {
        // given
        const mockError = new Error(`This username does not exist...`);
        mockError.status = 404;
        LoginService.authUser.mockRejectedValue(mockError)
        mockReq = { body: { username: "joe", password: "strongPass" }}

        // when
        const result = await LoginController.authUser(mockReq, mockRes);

        // then
        expect(result.status).toHaveBeenCalledWith(404);
        expect(result.json).toHaveBeenCalledWith({error: "This username does not exist..."});
    });

    it('should return error 400 if no username', async () => {
        // given
        mockReq = { body: { password: "strongPass" }}

        // when
        const result = await LoginController.authUser(mockReq, mockRes);

        // then
        expect(result.status).toHaveBeenCalledWith(400);
        expect(result.json).toHaveBeenCalledWith({ error: "Username is required." });
    });

    it('should return error 400 if no password', async () => {
        // given
        mockReq = { body: { username: "joe" }}

        // when
        const result = await LoginController.authUser(mockReq, mockRes);

        // then
        expect(result.status).toHaveBeenCalledWith(400);
        expect(result.json).toHaveBeenCalledWith({ error: "Password is required." });
    });
});