/**
 * Unit тесты для модуля rate limiting
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { 
  rateLimitMiddleware,
  mobileRateLimit,
  adminRateLimit,
  hugsRateLimit,
  cleanupExpiredRateLimits,
  getRateLimitStats,
  resetRateLimit,
  __resetRateLimitStoreForTests
} from '../../core/rateLimit';

// Мокируем Remote Config
jest.mock('../../core/remoteConfig', () => ({
  getDefaultRateLimitConfig: jest.fn(),
  getMobileRateLimitConfig: jest.fn(),
  getAdminRateLimitConfig: jest.fn(),
  getHugsRateLimitConfig: jest.fn(),
  getWebhooksRateLimitConfig: jest.fn(),
  getPublicRateLimitConfig: jest.fn(),
}));

jest.mock('../../core/firebase', () => {
  const mockCollection = jest.fn();
  const mockDoc = jest.fn();
  const mockGet = jest.fn();
  const mockSet = jest.fn();
  const mockUpdate = jest.fn();
  const mockDelete = jest.fn();
  const mockWhere = jest.fn();
  const mockLimit = jest.fn();
  const mockCount = jest.fn();
  const mockBatch = jest.fn();
  const mockCommit = jest.fn();
  const mockRunTransaction = jest.fn();

  return {
    db: {
      collection: mockCollection,
      runTransaction: mockRunTransaction,
      batch: mockBatch,
    },
    // Экспортируем моки для использования в тестах
    __mocks: {
      mockCollection,
      mockDoc,
      mockGet,
      mockSet,
      mockUpdate,
      mockDelete,
      mockWhere,
      mockLimit,
      mockCount,
      mockBatch,
      mockCommit,
      mockRunTransaction,
    },
  };
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    increment: jest.fn((n: number) => ({ increment: n }))
  }
}));

describe('Rate Limit Middleware Unit Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mocks: any;
  let remoteConfigMocks: any;

  beforeEach(async () => {
    // Получаем моки из модулей
    const firebaseModule = await import('../../core/firebase');
    const remoteConfigModule = await import('../../core/remoteConfig');
    mocks = (firebaseModule as any).__mocks;
    remoteConfigMocks = remoteConfigModule as any;
    
    jest.clearAllMocks();
    
    // Настройка моков Remote Config
    remoteConfigMocks.getDefaultRateLimitConfig.mockResolvedValue({ limit: 60, windowSec: 60 });
    remoteConfigMocks.getMobileRateLimitConfig.mockResolvedValue({ limit: 60, windowSec: 60 });
    remoteConfigMocks.getAdminRateLimitConfig.mockResolvedValue({ limit: 300, windowSec: 60 });
    remoteConfigMocks.getHugsRateLimitConfig.mockResolvedValue({ limit: 10, windowSec: 60 });
    remoteConfigMocks.getWebhooksRateLimitConfig.mockResolvedValue({ limit: 100, windowSec: 60 });
    remoteConfigMocks.getPublicRateLimitConfig.mockResolvedValue({ limit: 30, windowSec: 60 });
    
    // Настройка моков для цепочек вызовов Firestore
    mocks.mockGet.mockResolvedValue({ exists: false });
    mocks.mockSet.mockResolvedValue(undefined);
    mocks.mockUpdate.mockResolvedValue(undefined);
    mocks.mockDelete.mockResolvedValue(undefined);
    mocks.mockCommit.mockResolvedValue(undefined);
    mocks.mockRunTransaction.mockImplementation(async (callback: any) => {
      const transaction = {
        get: mocks.mockGet,
        set: mocks.mockSet,
        update: mocks.mockUpdate,
        delete: mocks.mockDelete,
      };
      return callback(transaction);
    });
    
    mocks.mockDoc.mockReturnValue({
      get: mocks.mockGet,
      set: mocks.mockSet,
      update: mocks.mockUpdate,
      delete: mocks.mockDelete,
    });
    
    mocks.mockWhere.mockReturnValue({
      limit: mocks.mockLimit,
      count: mocks.mockCount,
      where: mocks.mockWhere, // Поддержка цепочки where().where()
    });
    
    mocks.mockLimit.mockReturnValue({
      get: mocks.mockGet,
    });
    
    mocks.mockCount.mockReturnValue({
      get: mocks.mockGet,
    });
    
    mocks.mockCollection.mockReturnValue({
      doc: mocks.mockDoc,
      where: mocks.mockWhere,
      count: mocks.mockCount,
    });
    
    mocks.mockBatch.mockReturnValue({
      delete: mocks.mockDelete,
      commit: mocks.mockCommit,
    });
    
    mockRequest = {
      method: 'POST',
      headers: {},
      ip: '192.168.1.1',
      body: { test: 'data' }
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any,
      setHeader: jest.fn().mockReturnThis() as any
    };
    
    mockNext = jest.fn();
  });

  afterEach(async () => {
    // Убираем вызов __resetRateLimitStoreForTests из unit тестов
    // так как мы используем моки, а не реальную Firestore
  });

  describe('rateLimitMiddleware', () => {
    test('должен пропускать запросы в пределах лимита', async () => {
      const middleware = rateLimitMiddleware({ limit: 10, windowSec: 60 });
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    test('должен включать заголовки Rate-Limit', async () => {
      const middleware = rateLimitMiddleware({ limit: 10, windowSec: 60 });
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    });
  });

  describe('специализированные middleware', () => {
    test('mobileRateLimit должен вызывать getMobileRateLimitConfig', async () => {
      const middleware = mobileRateLimit();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(remoteConfigMocks.getMobileRateLimitConfig).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '60');
    });

    test('adminRateLimit должен вызывать getAdminRateLimitConfig', async () => {
      const middleware = adminRateLimit();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(remoteConfigMocks.getAdminRateLimitConfig).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '300');
    });

    test('hugsRateLimit должен вызывать getHugsRateLimitConfig', async () => {
      const middleware = hugsRateLimit();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(remoteConfigMocks.getHugsRateLimitConfig).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    });
  });

  describe('утилиты', () => {
    test('cleanupExpiredRateLimits должен возвращать число', async () => {
      // Настраиваем мок для пустого результата
      mocks.mockGet.mockResolvedValue({ empty: true, size: 0, docs: [] });
      
      const count = await cleanupExpiredRateLimits();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('getRateLimitStats должен возвращать статистику', async () => {
      // Настраиваем мок для count запросов
      mocks.mockCount.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
      });
      
      // Мок для getAll запросов
      mocks.mockCollection.mockReturnValue({
        doc: mocks.mockDoc,
        where: mocks.mockWhere,
        count: mocks.mockCount,
        get: jest.fn().mockResolvedValue({ 
          docs: [], 
          forEach: jest.fn() 
        })
      });
      
      const stats = await getRateLimitStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byPrefix');
      expect(stats).toHaveProperty('expired');
      expect(typeof stats.total).toBe('number');
    });

    test('resetRateLimit должен работать без ошибок', async () => {
      await expect(resetRateLimit('test-key', 'test-prefix')).resolves.not.toThrow();
    });
  });
});
