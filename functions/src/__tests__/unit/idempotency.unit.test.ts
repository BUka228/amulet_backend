/**
 * Unit тесты для модуля идемпотентности
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { 
  idempotencyMiddleware,
  cleanupExpiredIdempotencyKeys,
  getIdempotencyStats,
  __resetIdempotencyStoreForTests
} from '../../core/idempotency';

jest.mock('../../core/firebase', () => {
  const mockCollection = jest.fn();
  const mockDoc = jest.fn();
  const mockGet = jest.fn();
  const mockSet = jest.fn();
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

describe('Idempotency Middleware Unit Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mocks: any;

  beforeEach(async () => {
    // Получаем моки из модуля
    const firebaseModule = await import('../../core/firebase');
    mocks = (firebaseModule as any).__mocks;
    
    jest.clearAllMocks();
    
    // Настройка моков для цепочек вызовов Firestore
    mocks.mockGet.mockResolvedValue({ exists: false });
    mocks.mockSet.mockResolvedValue(undefined);
    mocks.mockDelete.mockResolvedValue(undefined);
    mocks.mockCommit.mockResolvedValue(undefined);
    mocks.mockRunTransaction.mockImplementation(async (callback: any) => {
      const transaction = {
        get: mocks.mockGet,
        set: mocks.mockSet,
        update: mocks.mockSet,
        delete: mocks.mockDelete,
      };
      return callback(transaction);
    });
    
    mocks.mockDoc.mockReturnValue({
      get: mocks.mockGet,
      set: mocks.mockSet,
      delete: mocks.mockDelete,
    });
    
    mocks.mockWhere.mockReturnValue({
      limit: mocks.mockLimit,
      count: mocks.mockCount,
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
    // Убираем вызов __resetIdempotencyStoreForTests из unit тестов
    // так как мы используем моки, а не реальную Firestore
  });

  describe('idempotencyMiddleware', () => {
    test('должен пропускать запросы без Idempotency-Key', async () => {
      const middleware = idempotencyMiddleware();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    test('должен пропускать GET запросы', async () => {
      mockRequest.method = 'GET';
      mockRequest.headers = { 'idempotency-key': 'test-key' };
      
      const middleware = idempotencyMiddleware();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    test('должен отклонять ключи неправильной длины', async () => {
      mockRequest.headers = { 'idempotency-key': 'short' }; // < 8 символов
      
      const middleware = idempotencyMiddleware();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'invalid_argument',
        message: 'Idempotency key must be between 8 and 128 characters',
        details: { keyLength: 5 }
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('должен отклонять ключи с недопустимыми символами', async () => {
      mockRequest.headers = { 'idempotency-key': 'invalid@key!' };
      
      const middleware = idempotencyMiddleware();
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: 'invalid_argument',
        message: 'Idempotency key contains invalid characters',
        details: { allowedChars: 'a-z, A-Z, 0-9, _, -' }
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredIdempotencyKeys', () => {
    test('должен возвращать число очищенных записей', async () => {
      // Настраиваем мок для пустого результата
      mocks.mockGet.mockResolvedValue({ empty: true, size: 0, docs: [] });
      
      const count = await cleanupExpiredIdempotencyKeys();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getIdempotencyStats', () => {
    test('должен возвращать статистику', async () => {
      // Настраиваем мок для count запросов
      mocks.mockCount.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
      });
      
      const stats = await getIdempotencyStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('expired');
      expect(typeof stats.total).toBe('number');
    });
  });
});
