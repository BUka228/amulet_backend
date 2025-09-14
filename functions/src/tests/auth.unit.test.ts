/**
 * Unit тесты для middleware аутентификации
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { 
  authenticateToken, 
  verifyAppCheck, 
  requireRole, 
  requireOwnership,
  getCurrentUser,
  hasRole,
  isOwner
} from '../core/auth';
import { Request, Response, NextFunction } from 'express';

// Мок для Firebase Admin
const mockVerifyIdToken = jest.fn();
const mockGetUser = jest.fn();
const mockAppCheck = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser
  })),
  appCheck: jest.fn(() => ({
    verifyToken: mockAppCheck
  }))
}));

describe('Auth Middleware Unit Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      headers: {},
      auth: undefined,
      appCheck: undefined
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
  });

  describe('authenticateToken', () => {
    test('должен создать middleware функцию', () => {
      const middleware = authenticateToken();
      expect(typeof middleware).toBe('function');
    });

    test('должен создать middleware с опциями', () => {
      const middleware = authenticateToken({
        requireEmailVerified: true,
        requireCustomClaim: 'admin',
        allowAnonymous: false
      });
      expect(typeof middleware).toBe('function');
    });

    test('должен обрабатывать отсутствие authorization header', async () => {
      const middleware = authenticateToken();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Missing or invalid authorization header'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать неправильный формат authorization header', async () => {
      mockRequest.headers = { authorization: 'InvalidFormat token' };
      
      const middleware = authenticateToken();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Missing or invalid authorization header'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать пустой токен', async () => {
      mockRequest.headers = { authorization: 'Bearer ' };
      
      const middleware = authenticateToken();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Missing ID token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('verifyAppCheck', () => {
    test('должен быть функцией', () => {
      expect(typeof verifyAppCheck).toBe('function');
    });

    test('должен обрабатывать отсутствие App Check токена', async () => {
      await verifyAppCheck(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'App Check token required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать валидный App Check токен', async () => {
      const mockAppCheckClaims = {
        appId: 'test-app-id',
        token: 'valid-token'
      };

      mockAppCheck.mockResolvedValue(mockAppCheckClaims);
      mockRequest.headers = { 'x-firebase-app-check': 'valid-token' };
      
      await verifyAppCheck(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockAppCheck).toHaveBeenCalledWith('valid-token');
      expect(mockRequest.appCheck).toBeDefined();
      expect(mockRequest.appCheck?.isVerified).toBe(true);
      expect(mockRequest.appCheck?.appId).toBe('test-app-id');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    test('должен создать middleware функцию', () => {
      const middleware = requireRole('admin');
      expect(typeof middleware).toBe('function');
    });

    test('должен обрабатывать отсутствие auth контекста', () => {
      const middleware = requireRole('admin');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: "Role 'admin' required"
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать отсутствие custom claims', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: {}
        },
        token: 'test-token',
        isAuthenticated: true
      };

      const middleware = requireRole('admin');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: "Role 'admin' required"
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireOwnership', () => {
    test('должен создать middleware функцию', () => {
      const middleware = requireOwnership();
      expect(typeof middleware).toBe('function');
    });

    test('должен создать middleware с кастомным полем', () => {
      const middleware = requireOwnership('customOwnerField');
      expect(typeof middleware).toBe('function');
    });

    test('должен обрабатывать отсутствие auth контекста', () => {
      const middleware = requireOwnership();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'unauthenticated',
        message: 'Authentication required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать отсутствие ownerId в параметрах', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: {}
        },
        token: 'test-token',
        isAuthenticated: true
      };

      const middleware = requireOwnership();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: 'Access denied: insufficient permissions'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен обрабатывать несовпадение ownerId', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: {}
        },
        token: 'test-token',
        isAuthenticated: true
      };
      mockRequest.params = { ownerId: 'different-uid' };

      const middleware = requireOwnership();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'permission_denied',
        message: 'Access denied: insufficient permissions'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен разрешить доступ при совпадении ownerId', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: {}
        },
        token: 'test-token',
        isAuthenticated: true
      };
      mockRequest.params = { ownerId: 'test-uid' };

      const middleware = requireOwnership();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Утилиты', () => {
    test('getCurrentUser должна возвращать пользователя из контекста', () => {
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        emailVerified: true,
        disabled: false,
        metadata: { creationTime: '2023-01-01T00:00:00Z' },
        customClaims: {}
      };

      mockRequest.auth = {
        user: mockUser,
        token: 'test-token',
        isAuthenticated: true
      };

      const user = getCurrentUser(mockRequest as Request);
      expect(user).toEqual(mockUser);
    });

    test('getCurrentUser должна возвращать null при отсутствии контекста', () => {
      const user = getCurrentUser(mockRequest as Request);
      expect(user).toBeNull();
    });

    test('hasRole должна проверять роль пользователя', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: { admin: true, moderator: false }
        },
        token: 'test-token',
        isAuthenticated: true
      };

      expect(hasRole(mockRequest as Request, 'admin')).toBe(true);
      expect(hasRole(mockRequest as Request, 'moderator')).toBe(false);
      expect(hasRole(mockRequest as Request, 'user')).toBe(false);
    });

    test('hasRole должна возвращать false при отсутствии контекста', () => {
      expect(hasRole(mockRequest as Request, 'admin')).toBe(false);
    });

    test('isOwner должна проверять владение ресурсом', () => {
      mockRequest.auth = {
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: '2023-01-01T00:00:00Z' },
          customClaims: {}
        },
        token: 'test-token',
        isAuthenticated: true
      };

      expect(isOwner(mockRequest as Request, 'test-uid')).toBe(true);
      expect(isOwner(mockRequest as Request, 'different-uid')).toBe(false);
    });

    test('isOwner должна возвращать false при отсутствии контекста', () => {
      expect(isOwner(mockRequest as Request, 'test-uid')).toBe(false);
    });
  });

  describe('Обработка ошибок', () => {
    test('должен корректно обрабатывать различные типы ошибок Firebase', async () => {
      const errorCases = [
        { error: new Error('Token expired'), expectedCode: 'token_expired' },
        { error: new Error('Invalid token'), expectedCode: 'unauthenticated' },
        { error: new Error('User not found'), expectedCode: 'unauthenticated' },
        { error: new Error('Network error'), expectedCode: 'unauthenticated' }
      ];

      for (const { error, expectedCode } of errorCases) {
        mockVerifyIdToken.mockRejectedValueOnce(error);
        mockRequest.headers = { authorization: 'Bearer test-token' };

        const middleware = authenticateToken();
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: expectedCode
          })
        );
        expect(mockNext).not.toHaveBeenCalled();

        // Очистка для следующего теста
        jest.clearAllMocks();
      }
    });
  });
});
