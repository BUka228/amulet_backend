/**
 * Простые тесты для middleware аутентификации
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { authenticateToken, verifyAppCheck, requireRole } from '../core/auth';

// Мок для Firebase Admin
jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
    getUser: jest.fn()
  }))
}));

describe('Auth Middleware Simple Tests', () => {
  beforeEach(() => {
    // Очистка моков перед каждым тестом
    jest.clearAllMocks();
  });

  test('должен создать middleware с опциями по умолчанию', () => {
    const middleware = authenticateToken();
    expect(typeof middleware).toBe('function');
  });

  test('должен создать middleware с кастомными опциями', () => {
    const middleware = authenticateToken({
      requireEmailVerified: true,
      requireCustomClaim: 'admin',
      allowAnonymous: false
    });
    expect(typeof middleware).toBe('function');
  });

  test('должен создать middleware для проверки роли', () => {
    const middleware = requireRole('admin');
    expect(typeof middleware).toBe('function');
  });

  test('должен создать middleware для App Check', () => {
    expect(typeof verifyAppCheck).toBe('function');
  });
});
