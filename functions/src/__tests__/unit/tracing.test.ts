/**
 * Тесты для трейсинга
 * 
 * Проверяем:
 * - Создание спанов для HTTP запросов
 * - Работу с вложенными спанами
 * - Обработку ошибок в спанах
 * - Middleware для Express
 * - Утилиты для трейсинга
 */

import { Request, Response, NextFunction } from 'express';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Создаем моки для OpenTelemetry
const mockSpan = {
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
  addEvent: jest.fn(),
};

const mockTracer = {
  startSpan: jest.fn(() => mockSpan),
};

// Мокаем OpenTelemetry API
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => mockTracer),
    getActiveSpan: jest.fn(),
  },
  SpanKind: {
    SERVER: 'server',
    CLIENT: 'client',
    INTERNAL: 'internal',
  },
  SpanStatusCode: {
    OK: 'ok',
    ERROR: 'error',
    UNSET: 'unset',
  },
}));

// Импортируем после мокинга
import { tracingService, tracingMiddleware, traceUtils, TraceContext } from '../../core/tracing';

describe('TracingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRequestTrace', () => {
    it('должен создавать трейс для HTTP запроса', () => {
      const mockReq = {
        method: 'POST',
        path: '/api/users',
        url: '/api/users',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-123',
        },
      } as unknown as Request;

      const mockRes = {
        on: jest.fn(),
        statusCode: 201,
        get: jest.fn().mockReturnValue('1024'),
      } as unknown as Response;

      const mockNext = jest.fn();

      tracingService.createRequestTrace(mockReq, mockRes, mockNext);

      expect(mockTracer.startSpan).toHaveBeenCalledWith('POST /api/users', {
        kind: 'server',
        attributes: {
          'http.method': 'POST',
          'http.url': '/api/users',
          'http.route': '/api/users',
          'http.user_agent': 'Mozilla/5.0',
          'http.request_id': 'req-123',
        },
      });

      expect(mockNext).toHaveBeenCalled();
    });

    it('должен обрабатывать завершение запроса', () => {
      const mockReq = {
        method: 'GET',
        path: '/api/test',
        url: '/api/test',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-456',
        },
      } as unknown as Request;

      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            // Симулируем завершение запроса
            callback();
          }
        }),
        statusCode: 200,
        get: jest.fn().mockReturnValue('512'),
      } as unknown as Response;

      const mockNext = jest.fn();

      tracingService.createRequestTrace(mockReq, mockRes, mockNext);

      // Проверяем, что span создан
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('должен обрабатывать ошибки запроса', () => {
      const mockError = new Error('Request failed');
      
      const mockReq = {
        method: 'POST',
        path: '/api/error',
        url: '/api/error',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-error',
        },
      } as unknown as Request;

      const mockRes = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            // Симулируем ошибку запроса
            callback(mockError);
          }
        }),
      } as unknown as Response;

      const mockNext = jest.fn();

      tracingService.createRequestTrace(mockReq, mockRes, mockNext);

      // Проверяем, что span создан
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createSpan', () => {
    it('должен создавать спан с опциями', () => {
      const options = {
        name: 'test-operation',
        kind: SpanKind.INTERNAL,
        attributes: {
          'test.attr': 'value',
        },
      };

      const span = tracingService.createSpan(options);

      expect(mockTracer.startSpan).toHaveBeenCalledWith('test-operation', {
        kind: 'internal',
        attributes: {
          'test.attr': 'value',
        },
      });
      expect(span).toBe(mockSpan);
    });
  });

  describe('executeInSpan', () => {
    it('должен выполнять асинхронную операцию в спане', async () => {
      const options = {
        name: 'async-operation',
        kind: SpanKind.INTERNAL,
      };

      const operation = jest.fn().mockResolvedValue('result');

      const result = await tracingService.executeInSpan(options, operation);

      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(operation).toHaveBeenCalledWith(mockSpan);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ok' });
      expect(mockSpan.end).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('должен обрабатывать ошибки в асинхронной операции', async () => {
      const options = {
        name: 'async-operation',
        kind: SpanKind.INTERNAL,
      };

      const error = new Error('Operation failed');
      const operation = jest.fn().mockRejectedValue(error);

      await expect(tracingService.executeInSpan(options, operation)).rejects.toThrow('Operation failed');

      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 'error',
        message: 'Operation failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('executeInSpanSync', () => {
    it('должен выполнять синхронную операцию в спане', () => {
      const options = {
        name: 'sync-operation',
        kind: SpanKind.INTERNAL,
      };

      const operation = jest.fn().mockReturnValue('result');

      const result = tracingService.executeInSpanSync(options, operation);

      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(operation).toHaveBeenCalledWith(mockSpan);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ok' });
      expect(mockSpan.end).toHaveBeenCalled();
      expect(result).toBe('result');
    });
  });

  describe('Специализированные спаны', () => {
    it('должен создавать спан для базы данных', () => {
      const span = tracingService.createDatabaseSpan('find', 'users');

      expect(mockTracer.startSpan).toHaveBeenCalledWith('db.find', {
        kind: 'client',
        attributes: {
          'db.operation': 'find',
          'db.collection': 'users',
          'db.system': 'firestore',
        },
      });
      expect(span).toBe(mockSpan);
    });

    it('должен создавать спан для внешних API', () => {
      const span = tracingService.createExternalApiSpan('payment-service', '/api/charge');

      expect(mockTracer.startSpan).toHaveBeenCalledWith('external.payment-service', {
        kind: 'client',
        attributes: {
          'external.service': 'payment-service',
          'external.endpoint': '/api/charge',
        },
      });
      expect(span).toBe(mockSpan);
    });

    it('должен создавать спан для фоновых задач', () => {
      const span = tracingService.createBackgroundSpan('cleanup');

      expect(mockTracer.startSpan).toHaveBeenCalledWith('background.cleanup', {
        kind: 'internal',
        attributes: {
          'background.task': 'cleanup',
        },
      });
      expect(span).toBe(mockSpan);
    });
  });

  describe('Утилиты', () => {
    it('должен предоставлять утилиты для быстрого доступа', async () => {
      const options = {
        name: 'test-span',
        kind: SpanKind.INTERNAL,
      };

      // Тестируем span утилиту
      const span = traceUtils.span(options);
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(span).toBe(mockSpan);

      // Тестируем execute утилиту
      const operation = jest.fn().mockResolvedValue('result');
      const result = await traceUtils.execute(options, operation);
      expect(result).toBe('result');

      // Тестируем executeSync утилиту
      const syncOperation = jest.fn().mockReturnValue('result');
      const syncResult = traceUtils.executeSync(options, syncOperation);
      expect(syncResult).toBe('result');
    });
  });

  describe('Middleware', () => {
    it('должен создавать middleware для Express', () => {
      const middleware = tracingMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('должен вызывать createRequestTrace в middleware', () => {
      const mockReq = {
        method: 'GET',
        path: '/api/test',
        url: '/api/test',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'x-request-id': 'req-123',
        },
      } as Request;
      const mockRes = {
        on: jest.fn(),
        statusCode: 200,
        get: jest.fn().mockReturnValue('512'),
      } as unknown as Response;
      const mockNext = jest.fn();

      const createRequestTraceSpy = jest.spyOn(tracingService, 'createRequestTrace');

      const middleware = tracingMiddleware();
      middleware(mockReq, mockRes, mockNext);

      expect(createRequestTraceSpy).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
    });
  });

  describe('getCurrentTraceContext', () => {
    it('должен возвращать текущий контекст трейса', () => {
      const mockActiveSpan = {
        spanContext: () => ({
          traceId: 'trace-123',
          spanId: 'span-456',
        }),
      };

      const { trace } = require('@opentelemetry/api');
      trace.getActiveSpan.mockReturnValue(mockActiveSpan);

      const context = tracingService.getCurrentTraceContext();

      expect(context).toEqual({
        traceId: 'trace-123',
        spanId: 'span-456',
      });
    });

    it('должен возвращать undefined если нет активного спана', () => {
      const { trace } = require('@opentelemetry/api');
      trace.getActiveSpan.mockReturnValue(null);

      const context = tracingService.getCurrentTraceContext();

      expect(context).toBeNull();
    });
  });
});