/**
 * Тесты для структурированного логирования
 * 
 * Проверяем:
 * - Корректность создания логов разных типов
 * - Правильность форматирования контекста
 * - Работу с различными уровнями логирования
 * - Обработку ошибок
 */

import { Request, Response } from 'express';
import { log, StructuredLogger, LogLevel } from '../../core/structuredLogger';

// Мокаем firebase-functions/logger
jest.mock('firebase-functions/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('StructuredLogger', () => {
  let logger: StructuredLogger;
  let mockLogger: any;

  beforeEach(() => {
    logger = new StructuredLogger();
    mockLogger = require('firebase-functions/logger');
    // Очищаем моки перед каждым тестом
    jest.clearAllMocks();
  });

  describe('Создание логов', () => {
    it('должен создавать info лог с базовым контекстом', () => {
      const context = {
        requestId: 'req-123',
        userId: 'user-456',
        route: '/api/test',
      };

      logger.info('Test message', context);

      expect(mockLogger.info).toHaveBeenCalledWith('Test message', {
        message: 'Test message',
        requestId: 'req-123',
        userId: 'user-456',
        route: '/api/test',
        timestamp: expect.any(String),
        severity: 'info',
      });
    });

    it('должен создавать error лог с деталями ошибки', () => {
      const context = {
        requestId: 'req-123',
        error: {
          name: 'ValidationError',
          message: 'Invalid input',
          stack: 'Error stack trace',
        },
      };

      logger.error('Operation failed', context);

      expect(mockLogger.error).toHaveBeenCalledWith('Operation failed', {
        message: 'Operation failed',
        requestId: 'req-123',
        error: {
          name: 'ValidationError',
          message: 'Invalid input',
          stack: 'Error stack trace',
        },
        timestamp: expect.any(String),
        severity: 'error',
      });
    });

    it('должен создавать warn лог для событий безопасности', () => {
      const context = {
        requestId: 'req-123',
        securityEvent: 'suspicious_activity',
        ip: '192.168.1.1',
      };

      logger.warn('Security event detected', context);

      expect(mockLogger.warn).toHaveBeenCalledWith('Security event detected', {
        message: 'Security event detected',
        requestId: 'req-123',
        securityEvent: 'suspicious_activity',
        ip: '192.168.1.1',
        timestamp: expect.any(String),
        severity: 'warn',
      });
    });
  });

  describe('Специализированные методы', () => {
    it('должен создавать request лог', () => {
      const mockReq = {
        method: 'POST',
        path: '/api/users',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-123',
        },
        ip: '192.168.1.1',
      } as unknown as Request;

      const context = {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      logger.logRequest(mockReq, context);

      expect(mockLogger.info).toHaveBeenCalledWith('HTTP request', {
        message: 'HTTP request',
        requestId: 'req-123',
        route: 'POST /api/users',
        latency: expect.any(Number),
        operation: 'api_call',
        method: 'POST',
        path: '/api/users',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: expect.any(String),
        severity: 'info',
      });
    });

    it('должен создавать response лог', () => {
      const mockReq = {
        method: 'POST',
        path: '/api/users',
        headers: {
          'x-request-id': 'req-123',
        },
      } as unknown as Request;

      const context = {
        latency: 150,
      };

      logger.logResponse(mockReq, 201, context);

      expect(mockLogger.info).toHaveBeenCalledWith('HTTP response', {
        message: 'HTTP response',
        requestId: 'req-123',
        route: 'POST /api/users',
        latency: expect.any(Number),
        operation: 'api_call',
        status: 201,
        timestamp: expect.any(String),
        severity: 'info',
      });
    });

    it('должен создавать business лог', () => {
      const context = {
        businessOperation: 'user_registration',
        resource: 'user_profile',
        userId: 'user-456',
        metadata: {
          plan: 'premium',
          source: 'web',
        },
      };

      logger.logBusinessOperation('user_registration', 'user_profile', 'User registered successfully', context);

      expect(mockLogger.info).toHaveBeenCalledWith('User registered successfully', {
        message: 'User registered successfully',
        operation: 'business_operation',
        resource: 'user_profile',
        businessOperation: 'user_registration',
        userId: 'user-456',
        metadata: {
          plan: 'premium',
          source: 'web',
        },
        timestamp: expect.any(String),
        severity: 'info',
      });
    });

    it('должен создавать performance лог', () => {
      const context = {
        performanceOperation: 'database_query',
        duration: 45,
        metadata: {
          query: 'SELECT * FROM users',
          rows: 100,
        },
      };

      logger.logPerformance('database_query', 45, context);

      expect(mockLogger.info).toHaveBeenCalledWith('Performance metric', {
        message: 'Performance metric',
        operation: 'performance',
        performanceOperation: 'database_query',
        duration: 45,
        latency: 45,
        metadata: {
          query: 'SELECT * FROM users',
          rows: 100,
        },
        timestamp: expect.any(String),
        severity: 'info',
      });
    });

    it('должен создавать security лог', () => {
      const context = {
        securityEvent: 'failed_login',
        ip: '192.168.1.1',
        userId: 'user-456',
        metadata: {
          attempts: 3,
          lastAttempt: '2024-01-01T12:00:00Z',
        },
      };

      logger.logSecurity('failed_login', 'Multiple failed login attempts', context);

      expect(mockLogger.warn).toHaveBeenCalledWith('Multiple failed login attempts', {
        message: 'Multiple failed login attempts',
        operation: 'security',
        securityEvent: 'failed_login',
        severity: 'warn',
        ip: '192.168.1.1',
        userId: 'user-456',
        metadata: {
          attempts: 3,
          lastAttempt: '2024-01-01T12:00:00Z',
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('Создание контекста запроса', () => {
    it('должен корректно извлекать startTime из запроса', () => {
      const mockReq = {
        startTime: 1234567890,
        method: 'GET',
        path: '/api/test',
        headers: {
          'x-request-id': 'req-123',
        },
      } as unknown as Request;

      const context = logger.createRequestContext(mockReq);

      expect(context).toEqual({
        requestId: 'req-123',
        route: 'GET /api/test',
        latency: expect.any(Number),
        operation: 'api_call',
      });
    });

    it('должен обрабатывать запрос без startTime', () => {
      const mockReq = {
        method: 'GET',
        path: '/api/test',
        headers: {
          'x-request-id': 'req-123',
        },
      } as unknown as Request;

      const context = logger.createRequestContext(mockReq);

      expect(context).toEqual({
        requestId: 'req-123',
        route: 'GET /api/test',
        latency: expect.any(Number),
        operation: 'api_call',
      });
    });
  });

  describe('Экспортированный объект log', () => {
    it('должен использовать singleton instance', () => {
      expect(log).toBeDefined();
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('должен работать с экспортированными методами', () => {
      const context = {
        requestId: 'req-123',
        userId: 'user-456',
      };

      log.info('Test message', context);

      expect(mockLogger.info).toHaveBeenCalledWith('Test message', {
        message: 'Test message',
        requestId: 'req-123',
        userId: 'user-456',
        timestamp: expect.any(String),
        severity: 'info',
      });
    });
  });

  describe('Обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки логирования', () => {
      const context = {
        requestId: 'req-123',
        userId: 'user-456',
      };

      // Мокаем logger.info чтобы он выбрасывал ошибку
      mockLogger.info.mockImplementation(() => {
        throw new Error('Logging failed');
      });

      // Проверяем, что ошибка выбрасывается (это ожидаемое поведение)
      expect(() => {
        logger.info('Test message', context);
      }).toThrow('Logging failed');
    });
  });
});

