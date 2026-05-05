import { jest } from '@jest/globals';

// aide IA: having issues with prisma being imported -> first mock then import with await
// 1. Mock the module using the unstable ESM-specific method
jest.unstable_mockModule('../../models/login-model.js', () => ({
    LoginModel: {
        getUserByUsername: jest.fn()
    }
}));

jest.unstable_mockModule('../../services/utils/pwd-hasher.js', () => ({
    verifyPassword: jest.fn()
}));

jest.unstable_mockModule('../../services/utils/jwt.js', () => ({
    generateAccessToken: jest.fn()
}));

// 2. You MUST use dynamic imports after the mocks are defined
const { LoginService } = await import('../../services/login-service.js');
const { LoginModel } = await import('../../models/login-model.js');
const { verifyPassword } = await import('../../services/utils/pwd-hasher.js');
const { generateAccessToken } = await import('../../services/utils/jwt.js');

describe('authUser', () => {
    // aide IA: how to mock data and simulate service success for jest tests
    const mockCredentials = { username: 'testuser', password: 'password123' };
    const mockUser = {
        id: 1,
        username: 'testuser',
        password: 'hashedPassword',
        email: 'test@test.com',
        role: 1
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return user ID and token on successful login', async () => {
        // given
        LoginModel.getUserByUsername.mockResolvedValue(mockUser);
        verifyPassword.mockResolvedValue(true);
        generateAccessToken.mockReturnValue('mocked-jwt-token');

        // when
        const result = await LoginService.authUser(mockCredentials);

        // then
        expect(result).toEqual({ id_user: 1, token: 'mocked-jwt-token' });
        expect(verifyPassword).toHaveBeenCalledWith('password123', 'hashedPassword');
    });

    it('should throw 404 if user does not exist', async () => {
        // given
        LoginModel.getUserByUsername.mockResolvedValue(null);

        // when & then
        await expect(LoginService.authUser(mockCredentials)).rejects.toMatchObject({
            message: 'This username does not exist...',
            status: 404
        });
    });

    it('should throw 401 if password is incorrect', async () => {
        // given
        LoginModel.getUserByUsername.mockResolvedValue(mockUser);
        verifyPassword.mockResolvedValue(false);

        // when & then
        await expect(LoginService.authUser(mockCredentials)).rejects.toMatchObject({
            message: 'Invalid password...',
            status: 401
        });
    });
});