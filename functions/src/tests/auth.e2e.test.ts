/**
 * E2E тесты для middleware аутентификации
 */

import * as admin from 'firebase-admin';
import { describe, beforeAll, beforeEach, test, expect, jest } from '@jest/globals';
import { authenticateToken, verifyAppCheck, requireRole } from '../core/auth';
import { Request, Response, NextFunction } from 'express';

// Мок для Express
const mockRequest = (headers: Record<string, string> = {}): Partial<Request> => ({
  headers,
  auth: undefined,
  appCheck: undefined
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return res;
};

const mockNext = (): NextFunction => jest.fn();

// Мок для Firebase Admin
const mockVerifyIdToken = jest.fn();
const mockGetUser = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser
  }))
}));

describe('Auth Middleware E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    test('должен успешно аутентифицировать пользователя с валидным токеном', async () => {
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        displayName: 'Test User',
        emailVerified: true,
        disabled: false,
        metadata: {
          creationTime: '2023-01-01T00:00:00Z',
          lastSignInTime: '2023-01-01T00:00:00Z'
        },
        customClaims: {}
      };

      const mockDecodedToken = {
        uid: 'test-uid',
        email: 'test@example.com',
        email_verified: true
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken as any);
      mockGetUser.mockResolvedValue(mockUser as any);

      const req = mockRequest({
        'authorization': 'Bearer valid-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken();
      await middleware(req, res, next);

      expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token', true);
      expect(mockGetUser).toHaveBeenCalledWith('test-uid');
      expect(req.auth).toBeDefined();
      expect(req.auth?.user.uid).toBe('test-uid');
      expect(req.auth?.isAuthenticated).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    test('должен вернуть 401 при отсутствии токена', async () => {
      const req = mockRequest() as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Missing or invalid authorization header'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('должен вернуть 401 при невалидном токене', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const req = mockRequest({
        'authorization': 'Bearer invalid-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Authentication failed'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('должен вернуть 401 при истекшем токене', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

      const req = mockRequest({
        'authorization': 'Bearer expired-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'token_expired',
        message: 'ID token has expired'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('должен требовать подтверждение email при включенной опции', async () => {
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        emailVerified: false,
        disabled: false,
        metadata: {
          creationTime: '2023-01-01T00:00:00Z'
        },
        customClaims: {}
      };

      const mockDecodedToken = {
        uid: 'test-uid',
        email: 'test@example.com',
        email_verified: false
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken as any);
      mockGetUser.mockResolvedValue(mockUser as any);

      const req = mockRequest({
        'authorization': 'Bearer valid-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken({ requireEmailVerified: true });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: 'Email verification required'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('должен требовать custom claim при включенной опции', async () => {
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        emailVerified: true,
        disabled: false,
        metadata: {
          creationTime: '2023-01-01T00:00:00Z'
        },
        customClaims: {}
      };

      const mockDecodedToken = {
        uid: 'test-uid',
        email: 'test@example.com',
        email_verified: true
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken as any);
      mockGetUser.mockResolvedValue(mockUser as any);

      const req = mockRequest({
        'authorization': 'Bearer valid-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken({ requireCustomClaim: 'admin' });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: "Custom claim 'admin' required"
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('должен разрешить анонимный доступ при включенной опции', async () => {
      const req = mockRequest() as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = authenticateToken({ allowAnonymous: true });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.auth).toBeUndefined();
    });
  });

  describe('verifyAppCheck', () => {
    test('должен успешно верифицировать App Check токен', async () => {
      const req = mockRequest({
        'x-firebase-app-check': 'valid-app-check-token'
      }) as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      await verifyAppCheck(req, res, next);

      expect(req.appCheck).toBeDefined();
      expect(req.appCheck?.isVerified).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    test('должен вернуть 401 при отсутствии App Check токена', async () => {
      const req = mockRequest() as Request;
      const res = mockResponse() as Response;
      const next = mockNext();

      await verifyAppCheck(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'App Check token required'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    test('должен разрешить доступ пользователю с требуемой ролью', () => {
      const req = mockRequest({
        'authorization': 'Bearer valid-token'
      }) as Request;
      req.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: {
            creationTime: '2023-01-01T00:00:00Z'
          },
          customClaims: { admin: true }
        },
        token: 'valid-token',
        isAuthenticated: true
      };
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = requireRole('admin');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('должен запретить доступ пользователю без требуемой роли', () => {
      const req = mockRequest({
        'authorization': 'Bearer valid-token'
      }) as Request;
      req.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: {
            creationTime: '2023-01-01T00:00:00Z'
          },
          customClaims: {}
        },
        token: 'valid-token',
        isAuthenticated: true
      };
      const res = mockResponse() as Response;
      const next = mockNext();

      const middleware = requireRole('admin');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: "Role 'admin' required"
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Интеграционные тесты', () => {
    test('должен работать полный цикл аутентификации с валидным пользователем', async () => {
      const mockUser = {
        uid: 'integration-test-uid',
        email: 'integration@example.com',
        displayName: 'Integration Test User',
        emailVerified: true,
        disabled: false,
        metadata: {
          creationTime: '2023-01-01T00:00:00Z',
          lastSignInTime: '2023-01-01T00:00:00Z'
        },
        customClaims: { admin: true, moderator: true }
      };

      const mockDecodedToken = {
        uid: 'integration-test-uid',
        email: 'integration@example.com',
        email_verified: true
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken as any);
      mockGetUser.mockResolvedValue(mockUser as any);

      // Тест 1: Аутентификация
      const req1 = mockRequest({
        'authorization': 'Bearer integration-token'
      }) as Request;
      const res1 = mockResponse() as Response;
      const next1 = mockNext();

      const authMiddleware = authenticateToken();
      await authMiddleware(req1, res1, next1);

      expect(req1.auth?.user.uid).toBe('integration-test-uid');
      expect(req1.auth?.isAuthenticated).toBe(true);
      expect(next1).toHaveBeenCalled();

      // Тест 2: Проверка роли admin
      const req2 = mockRequest() as Request;
      req2.auth = req1.auth;
      const res2 = mockResponse() as Response;
      const next2 = mockNext();

      const adminMiddleware = requireRole('admin');
      adminMiddleware(req2, res2, next2);

      expect(next2).toHaveBeenCalled();

      // Тест 3: Проверка роли moderator
      const req3 = mockRequest() as Request;
      req3.auth = req1.auth;
      const res3 = mockResponse() as Response;
      const next3 = mockNext();

      const moderatorMiddleware = requireRole('moderator');
      moderatorMiddleware(req3, res3, next3);

      expect(next3).toHaveBeenCalled();
    });

    test('должен корректно обрабатывать ошибки аутентификации', async () => {
      // Тест различных типов ошибок
      const errorCases = [
        { error: new Error('Token expired'), expectedCode: 'token_expired' },
        { error: new Error('Invalid token'), expectedCode: 'unauthenticated' },
        { error: new Error('Network error'), expectedCode: 'unauthenticated' }
      ];

      for (const { error, expectedCode } of errorCases) {
        mockVerifyIdToken.mockRejectedValueOnce(error);

        const req = mockRequest({
          'authorization': 'Bearer test-token'
        }) as Request;
        const res = mockResponse() as Response;
        const next = mockNext();

        const middleware = authenticateToken();
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: expectedCode
          })
        );
        expect(next).not.toHaveBeenCalled();
      }
    });
  });
});