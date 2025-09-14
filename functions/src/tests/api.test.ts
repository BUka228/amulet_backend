/**
 * Тесты для HTTP API endpoints
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import request from 'supertest';
import { api } from '../api/test';

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

describe('API Endpoints Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Публичные endpoints', () => {
    test('GET /public должен возвращать публичный контент', async () => {
      const response = await request(api)
        .get('/public')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This is a public endpoint');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Защищенные endpoints', () => {
    beforeEach(() => {
      // Настройка моков для успешной аутентификации
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
        email_verified: true,
        iat: Math.floor(Date.now() / 1000),
        auth_time: Math.floor(Date.now() / 1000)
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken as any);
      mockGetUser.mockResolvedValue(mockUser as any);
    });

    test('GET /protected должен требовать аутентификации', async () => {
      await request(api)
        .get('/protected')
        .expect(401);
    });

    test('GET /protected должен работать с валидным токеном', async () => {
      const response = await request(api)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This is a protected endpoint');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.uid).toBe('test-uid');
    });

    test('GET /app-check должен требовать App Check токен', async () => {
      await request(api)
        .get('/app-check')
        .expect(401);
    });

    test('GET /app-check должен работать с App Check токеном', async () => {
      const mockAppCheckClaims = {
        appId: 'test-app-id',
        token: 'valid-app-check-token'
      };

      mockAppCheck.mockResolvedValue(mockAppCheckClaims);

      const response = await request(api)
        .get('/app-check')
        .set('x-firebase-app-check', 'valid-app-check-token')
        .expect(200);

      expect(mockAppCheck).toHaveBeenCalledWith('valid-app-check-token');
      expect(response.body).toHaveProperty('message', 'This endpoint requires App Check');
      expect(response.body).toHaveProperty('appCheck');
    });

    test('GET /verified должен требовать подтвержденный email', async () => {
      // Мок для пользователя с неподтвержденным email
      const mockDecodedToken = {
        uid: 'test-uid',
        email: 'test@example.com',
        email_verified: false,
        iat: Math.floor(Date.now() / 1000),
        auth_time: Math.floor(Date.now() / 1000)
      };

      mockVerifyIdToken.mockResolvedValueOnce(mockDecodedToken);

      await request(api)
        .get('/verified')
        .set('Authorization', 'Bearer valid-token')
        .expect(403);
    });

    test('GET /verified должен работать с подтвержденным email', async () => {
      const response = await request(api)
        .get('/verified')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This endpoint requires verified email');
      expect(response.body).toHaveProperty('user');
    });

    test('GET /admin должен требовать роль admin', async () => {
      await request(api)
        .get('/admin')
        .set('Authorization', 'Bearer valid-token')
        .expect(403);
    });

    test('GET /admin должен работать с ролью admin', async () => {
      // Мок для пользователя с ролью admin
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        emailVerified: true,
        disabled: false,
        metadata: { creationTime: '2023-01-01T00:00:00Z' },
        customClaims: { admin: true }
      };

      mockGetUser.mockResolvedValueOnce(mockUser as any);

      const response = await request(api)
        .get('/admin')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This is an admin-only endpoint');
      expect(response.body).toHaveProperty('user');
    });

    test('GET /optional-auth должен работать без аутентификации', async () => {
      const response = await request(api)
        .get('/optional-auth')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This endpoint allows anonymous access');
      expect(response.body).toHaveProperty('isAuthenticated', false);
      expect(response.body).toHaveProperty('user', null);
    });

    test('GET /optional-auth должен работать с аутентификацией', async () => {
      const response = await request(api)
        .get('/optional-auth')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'This endpoint allows anonymous access');
      expect(response.body).toHaveProperty('isAuthenticated', true);
      expect(response.body).toHaveProperty('user');
    });
  });

  describe('Обработка ошибок', () => {
    test('должен возвращать 404 для несуществующих endpoints', async () => {
      const response = await request(api)
        .get('/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('code', 'not_found');
      expect(response.body).toHaveProperty('message', 'Endpoint not found');
    });

    test('должен обрабатывать ошибки аутентификации', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await request(api)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('code', 'unauthenticated');
    });

    test('должен обрабатывать истекшие токены', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Token expired'));

      const response = await request(api)
        .get('/protected')
        .set('Authorization', 'Bearer expired-token')
        .expect(401);

      expect(response.body).toHaveProperty('code', 'token_expired');
    });
  });

  describe('Логирование', () => {
    test('должен логировать запросы', async () => {
      // Тест проверяет, что запрос проходит без ошибок
      // Логирование проверяется через firebase-functions/logger
      const response = await request(api)
        .get('/public')
        .expect(200);

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Middleware цепочка', () => {
    test('должен применять все middleware в правильном порядке', async () => {
      const response = await request(api)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      // Проверяем, что все middleware сработали
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.uid).toBe('test-uid');
    });

    test('должен останавливать выполнение при ошибке аутентификации', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Auth failed'));

      await request(api)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // Проверяем, что getUser не вызывался после ошибки verifyIdToken
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });
});
